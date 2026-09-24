'use server';

import { redirect } from 'next/navigation';
import { ParsedFormat, ProjectStatus } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { projectSchema } from '@/lib/validation';
import { detectFormat, parseScriptSource } from '@/lib/script/parse';
import { uploadFile, deleteFile } from '@/lib/blob';
import { randomToken } from '@/lib/utils';
import {
  REVALIDATE,
  requireOwnedProject,
  requireProducer,
  revalidate,
  runAction,
  type Failed,
} from './shared';

export async function createProject(locale: string, formData: FormData) {
  const user = await requireProducer();

  const parsed = projectSchema.safeParse({
    name: formData.get('name'),
    type: formData.get('type'),
    budgetTier: formData.get('budgetTier'),
    city: formData.get('city'),
    visualStyleTags: formData.getAll('visualStyleTags').map(String),
    shootStartDate: formData.get('shootStartDate') ?? '',
    shootEndDate: formData.get('shootEndDate') ?? '',
    synopsis: formData.get('synopsis') ?? '',
  });

  if (!parsed.success) return { ok: false as const, error: 'INVALID_INPUT' };
  const data = parsed.data;

  const project = await prisma.project.create({
    data: {
      ownerId: user.id,
      name: data.name,
      type: data.type,
      budgetTier: data.budgetTier,
      city: data.city,
      visualStyleTags: data.visualStyleTags,
      shootStartDate: data.shootStartDate ? new Date(data.shootStartDate) : null,
      shootEndDate: data.shootEndDate ? new Date(data.shootEndDate) : null,
      synopsis: data.synopsis || null,
    },
    select: { id: true },
  });

  revalidate(REVALIDATE.producerProjects);
  redirect(`/${locale}/producer/projects/${project.id}`);
}

/**
 * Stores the script and segments it immediately, so the producer sees the scene
 * count before paying for an analysis run. Parsing is deterministic code; the
 * agents only ever interpret what this produced.
 */
export async function saveScript(projectId: string, formData: FormData) {
  return runAction('saveScript', async () => {
    const { project } = await requireOwnedProject(projectId);

    const file = formData.get('file');
    const pasted = String(formData.get('pasted') ?? '').trim();

    let format: ParsedFormat;
    let rawText = '';
    let buffer: ArrayBuffer | undefined;
    let fileName: string | null = null;
    let fileUrl: string | null = null;

    if (file instanceof File && file.size > 0) {
      fileName = file.name;
      format = detectFormat(file.name, file.type);
      buffer = await file.arrayBuffer();
      if (format !== ParsedFormat.PDF) rawText = new TextDecoder('utf-8').decode(buffer);
      const stored = await uploadFile(file, `scripts/${projectId}`, 'script');
      fileUrl = stored.url;
    } else if (pasted) {
      format = ParsedFormat.PASTED;
      rawText = pasted;
    } else {
      throw new Error('NO_SCRIPT');
    }

    const parsed = await parseScriptSource({ format, text: rawText, buffer });

    // Replacing a script invalidates the scenes and the sheet built on them.
    if (project.script?.fileUrl && project.script.fileUrl !== fileUrl) {
      await deleteFile(project.script.fileUrl);
    }

    await prisma.$transaction(async (tx) => {
      const script = await tx.script.upsert({
        where: { projectId },
        create: {
          projectId,
          fileUrl,
          fileName,
          parsedFormat: format,
          rawText: parsed.rawText,
          pageCount: parsed.pageCount,
          sceneCount: parsed.scenes.length,
          parsedAt: new Date(),
        },
        update: {
          fileUrl,
          fileName,
          parsedFormat: format,
          rawText: parsed.rawText,
          pageCount: parsed.pageCount,
          sceneCount: parsed.scenes.length,
          parsedAt: new Date(),
        },
        select: { id: true },
      });

      await tx.scene.deleteMany({ where: { scriptId: script.id } });
      await tx.scene.createMany({
        data: parsed.scenes.map((scene) => ({
          scriptId: script.id,
          order: scene.order,
          heading: scene.heading,
          slug: scene.slug,
          bodyExcerpt: scene.bodyExcerpt,
          intExt: scene.intExt,
          timeOfDay: scene.timeOfDay,
          pageEighths: scene.pageEighths,
        })),
      });

      // A new script invalidates the sheet and any half-finished run.
      await tx.projectRecommendation.deleteMany({ where: { projectId } });
      await tx.analysisState.deleteMany({ where: { projectId } });
      await tx.project.update({
        where: { id: projectId },
        data: { status: ProjectStatus.SCRIPT_UPLOADED },
      });
    });

    revalidate(REVALIDATE.producerProject, REVALIDATE.producerProjects);
    return { sceneCount: parsed.scenes.length };
  });
}

export async function updateVisualStyle(projectId: string, tags: string[]) {
  return runAction('updateVisualStyle', async () => {
    await requireOwnedProject(projectId);
    await prisma.project.update({
      where: { id: projectId },
      data: { visualStyleTags: tags.slice(0, 8) },
    });
    revalidate(REVALIDATE.producerProject);
  });
}

export async function createShareLink(projectId: string): Promise<{ ok: true; token: string } | Failed> {
  return runAction('createShareLink', async () => {
    await requireOwnedProject(projectId);

    const existing = await prisma.shareLink.findFirst({
      where: { projectId, revoked: false },
      select: { token: true },
    });
    if (existing) return { token: existing.token };

    const link = await prisma.shareLink.create({
      data: { projectId, token: randomToken(18) },
      select: { token: true },
    });
    revalidate(REVALIDATE.producerProject);
    return { token: link.token };
  });
}

export async function revokeShareLinks(projectId: string) {
  return runAction('revokeShareLinks', async () => {
    await requireOwnedProject(projectId);
    await prisma.shareLink.updateMany({ where: { projectId }, data: { revoked: true } });
    revalidate(REVALIDATE.producerProject);
  });
}

export async function deleteProject(locale: string, projectId: string) {
  const { project } = await requireOwnedProject(projectId);
  if (project.script?.fileUrl) await deleteFile(project.script.fileUrl);
  await prisma.project.delete({ where: { id: projectId } });
  revalidate(REVALIDATE.producerProjects);
  redirect(`/${locale}/producer`);
}

'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { BudgetTier, ProjectType } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { deleteFile } from '@/lib/blob';
import { getSettings } from '@/lib/settings';
import { storeScript } from '@/lib/script-store';
import { randomToken } from '@/lib/utils';
import {
  REVALIDATE,
  requireOwnedProject,
  requireProducer,
  revalidate,
  runAction,
  type Failed,
} from './shared';

const startSchema = z.object({
  type: z.nativeEnum(ProjectType),
  budgetTier: z.nativeEnum(BudgetTier),
  city: z.string().trim().max(80),
  visualStyleTags: z.array(z.string().max(60)).max(8),
});

async function knownStyleTags(slugs: string[]) {
  if (slugs.length === 0) return [];
  const rows = await prisma.styleTag.findMany({ where: { slug: { in: slugs }, active: true }, select: { slug: true } });
  const known = new Set(rows.map((row) => row.slug));
  return slugs.filter((slug) => known.has(slug));
}

/** A readable name from the file name, or the first line of pasted text. */
function nameFromScript(fileName: string | null, pasted: string) {
  // "night-delivery.fountain" → "Night Delivery"
  const fromFile = fileName
    ?.replace(/\.[^.]+$/, '')
    .replace(/[-_]+/g, ' ')
    .trim()
    .replace(/(^|\s)\p{Ll}/gu, (letter) => letter.toUpperCase());
  const fromText = pasted
    .split('\n')
    .map((line) => line.trim())
    .find(Boolean);
  return (fromFile || fromText || 'Untitled script').slice(0, 120);
}

/**
 * Starts everything from a script: the project is created behind the scenes
 * with the few choices the user made, the script is stored and segmented, and
 * the caller goes straight to the analysis. What the brief leaves open is
 * asked later, in the conversation, by the clarify step.
 */
export async function startFromScript(formData: FormData) {
  return runAction('startFromScript', async () => {
    const user = await requireProducer();
    const settings = await getSettings();

    const parsed = startSchema.safeParse({
      type: formData.get('type'),
      budgetTier: formData.get('budgetTier'),
      city: formData.get('city') ?? '',
      visualStyleTags: formData.getAll('visualStyleTags').map(String),
    });
    if (!parsed.success) throw new Error('INVALID_INPUT');

    const file = formData.get('file');
    const pasted = String(formData.get('pasted') ?? '').trim();
    const fileName = file instanceof File && file.size > 0 ? file.name : null;
    if (!fileName && !pasted) throw new Error('NO_SCRIPT');

    const project = await prisma.project.create({
      data: {
        ownerId: user.id,
        name: nameFromScript(fileName, pasted),
        type: parsed.data.type,
        budgetTier: parsed.data.budgetTier,
        city: parsed.data.city || settings.defaultCity,
        // Only tags the platform knows; anything else would mislead the agents.
        visualStyleTags: await knownStyleTags(parsed.data.visualStyleTags),
      },
      select: { id: true },
    });

    try {
      await storeScript({ id: project.id, script: null }, formData);
    } catch (error) {
      // A script that cannot be read leaves nothing behind.
      await prisma.project.delete({ where: { id: project.id } }).catch(() => undefined);
      throw error;
    }

    revalidate(REVALIDATE.producerProjects);
    return { projectId: project.id };
  });
}

/**
 * Stores the script and segments it immediately, so the producer sees the scene
 * count before paying for an analysis run. Parsing is deterministic code; the
 * agents only ever interpret what this produced.
 */
export async function saveScript(projectId: string, formData: FormData) {
  return runAction('saveScript', async () => {
    const { project } = await requireOwnedProject(projectId);

    const result = await storeScript(project, formData);
    revalidate(REVALIDATE.producerProject, REVALIDATE.producerProjects);
    return { sceneCount: result.sceneCount };
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

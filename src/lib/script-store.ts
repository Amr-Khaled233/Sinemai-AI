import 'server-only';
import { ParsedFormat, ProjectStatus } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { detectFormat, parseScriptSource } from '@/lib/script/parse';
import { uploadFile, deleteFile } from '@/lib/blob';

/**
 * Stores a script for a project and segments it immediately, so the scene count
 * is known before any paid analysis. Parsing is deterministic code; the agents
 * only ever interpret what this produced. Replacing a script clears the sheet
 * and any half-finished run built on the old one.
 *
 * Callers check ownership first.
 */
export async function storeScript(
  project: { id: string; script: { fileUrl: string | null } | null },
  formData: FormData,
) {
  const projectId = project.id;
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


  return { sceneCount: parsed.scenes.length, fileName };
}

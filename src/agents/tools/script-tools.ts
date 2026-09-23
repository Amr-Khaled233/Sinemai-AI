import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { parseScriptSource } from '@/lib/script/parse';
import { loggedTool, type AgentRunHandle } from '../runtime';

/**
 * Script Analyst tools. Parsing and segmentation are deterministic code: the
 * agent decides what each scene *needs*, never what the scenes *are*.
 */

export const parseScriptSchema = z.object({
  force: z
    .boolean()
    .optional()
    .describe('Re-parse and replace existing scenes. Use only when the stored segmentation looks broken.'),
});

export const segmentScenesSchema = z.object({
  offset: z.number().int().min(0).describe('Zero-based index of the first scene to return.'),
  limit: z.number().int().min(1).max(20).describe('How many scenes to return (batch size).'),
});

export type SceneStub = {
  sceneId: string;
  order: number;
  heading: string;
  intExt: string | null;
  timeOfDay: string | null;
  pageEighths: number | null;
  excerpt: string;
};

export type ParseResult = {
  format: string;
  sceneCount: number;
  pageCount: number | null;
  fileName: string | null;
  reused: boolean;
};

async function loadScript(projectId: string) {
  const script = await prisma.script.findUnique({
    where: { projectId },
    include: { scenes: { orderBy: { order: 'asc' } } },
  });
  if (!script) throw new Error('NO_SCRIPT_UPLOADED');
  return script;
}

export async function parseScriptFile(projectId: string, args: z.infer<typeof parseScriptSchema>): Promise<ParseResult> {
  const script = await loadScript(projectId);

  if (script.scenes.length > 0 && !args.force) {
    return {
      format: script.parsedFormat,
      sceneCount: script.scenes.length,
      pageCount: script.pageCount,
      fileName: script.fileName,
      reused: true,
    };
  }

  const parsed = await parseScriptSource({ format: script.parsedFormat, text: script.rawText });

  await prisma.$transaction([
    prisma.scene.deleteMany({ where: { scriptId: script.id } }),
    prisma.scene.createMany({
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
    }),
    prisma.script.update({
      where: { id: script.id },
      data: { sceneCount: parsed.scenes.length, pageCount: parsed.pageCount, parsedAt: new Date() },
    }),
  ]);

  return {
    format: script.parsedFormat,
    sceneCount: parsed.scenes.length,
    pageCount: parsed.pageCount,
    fileName: script.fileName,
    reused: false,
  };
}

export async function segmentScenesBatch(
  projectId: string,
  args: z.infer<typeof segmentScenesSchema>,
): Promise<{ scenes: SceneStub[]; total: number; nextOffset: number | null }> {
  const script = await prisma.script.findUnique({ where: { projectId }, select: { id: true } });
  if (!script) throw new Error('NO_SCRIPT_UPLOADED');

  const total = await prisma.scene.count({ where: { scriptId: script.id } });
  const scenes = await prisma.scene.findMany({
    where: { scriptId: script.id },
    orderBy: { order: 'asc' },
    skip: args.offset,
    take: args.limit,
    select: {
      id: true,
      order: true,
      heading: true,
      intExt: true,
      timeOfDay: true,
      pageEighths: true,
      bodyExcerpt: true,
    },
  });

  const nextOffset = args.offset + scenes.length < total ? args.offset + scenes.length : null;

  return {
    total,
    nextOffset,
    scenes: scenes.map((s) => ({
      sceneId: s.id,
      order: s.order,
      heading: s.heading,
      intExt: s.intExt,
      timeOfDay: s.timeOfDay,
      pageEighths: s.pageEighths,
      // Trimmed: the analyst needs enough action to judge lighting and movement,
      // not the full scene.
      excerpt: s.bodyExcerpt.slice(0, 1200),
    })),
  };
}

export function makeScriptTools(handle: AgentRunHandle, context: { projectId: string }) {
  return {
    parseScriptFile: loggedTool(handle, 'parseScriptFile', {
      description:
        'Parse the uploaded screenplay (Fountain, Final Draft .fdx, PDF or plain text) into structured scenes and persist them. Idempotent: returns the existing segmentation when one is already stored.',
      inputSchema: parseScriptSchema,
      execute: (args) => parseScriptFile(context.projectId, args),
    }),

    segmentScenes: loggedTool(handle, 'segmentScenes', {
      description:
        'Return a batch of parsed scenes with their headings and action excerpts, for breakdown analysis.',
      inputSchema: segmentScenesSchema,
      execute: (args) => segmentScenesBatch(context.projectId, args),
    }),
  };
}

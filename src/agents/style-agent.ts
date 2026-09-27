import { generateObject } from 'ai';
import { z } from 'zod';
import { AgentName } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { getStyleTags } from '@/lib/settings';
import { model, MODELS, withAgentRun, type RunContext } from './runtime';
import { describeSummary } from './equipment-agent';
import type { ProjectBrief, SceneSummary } from './types';

const STYLE_SYSTEM = `You are a director of photography reading a script breakdown. Choose the visual style that serves this story best — the look the camera, lenses and lighting should aim for. Pick from the vocabulary only, one to three tags that work together, and say why in one sentence.`;

/**
 * The user does not pick a look; the assistant does. Runs once, after the
 * breakdown and before the equipment and cinematographer matching that the
 * look steers, and stores the tags on the project so every later step and the
 * sheet see them. A failure only means the run carries on without a look.
 */
export async function chooseVisualStyle(
  ctx: RunContext,
  brief: ProjectBrief,
  summary: SceneSummary,
): Promise<string[]> {
  if (brief.visualStyleTags.length > 0) return brief.visualStyleTags;
  const vocabulary = await getStyleTags();
  if (vocabulary.length === 0) return [];
  const slugs = vocabulary.map((tag) => tag.slug) as [string, ...string[]];

  try {
    return await withAgentRun(
      {
        ctx,
        agent: AgentName.ORCHESTRATOR,
        model: MODELS.cheap,
        systemPrompt: STYLE_SYSTEM,
        input: { stage: 'visual-style' },
      },
      async () => {
        const { object } = await generateObject({
          model: model('cheap'),
          schema: z.object({
            tags: z.array(z.enum(slugs)).min(1).max(3),
            reason: z.string().max(300),
          }),
          system: STYLE_SYSTEM,
          temperature: 0.2,
          prompt: [
            `Production: "${brief.name}" — ${brief.type}.`,
            brief.synopsis ? `Synopsis: ${brief.synopsis.slice(0, 1200)}` : '',
            '',
            'Scene breakdown statistics:',
            describeSummary(summary),
            '',
            'Vocabulary:',
            ...vocabulary.map((tag) => `- ${tag.slug}: ${tag.labelEn}`),
          ]
            .filter(Boolean)
            .join('\n'),
        });

        const tags = [...new Set(object.tags)];
        await prisma.project.update({ where: { id: brief.projectId }, data: { visualStyleTags: tags } });
        ctx.report({ type: 'log', message: `Visual style: ${tags.join(', ')} — ${object.reason}` });
        return { output: tags };
      },
    );
  } catch (error) {
    ctx.report({
      type: 'log',
      message: `Visual style skipped: ${error instanceof Error ? error.message : 'unknown error'}`,
    });
    return [];
  }
}

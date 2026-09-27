import { generateText, stepCountIs } from 'ai';
import { z } from 'zod';
import { AgentName } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { lastToolResult, loggedTool, model, MODELS, withAgentRun, type RunContext } from './runtime';
import { withLanguage } from './language';
import { MAX_FLAGS, normaliseFlags, sceneFlagHints, type FlagSceneInput } from './scene-flags';
import { SCENE_FLAG_KINDS, type ProjectBrief, type SceneFlag, type SceneRequirement } from './types';

export const SCENE_FLAG_SYSTEM = `You are a first assistant director reading a script breakdown before anything is planned. Your job is to spot the scenes the producer must know about now, because they change the money, the safety plan, the gear or the schedule — and to tell them in plain words.

Flag a scene when it:
- is dangerous: fights, stunts, fire, explosions, weapons, heights, fast vehicles, water work, anything that needs a stunt or safety team;
- needs a special camera or rig just for that moment: underwater housing, high-speed/slow-motion, drone, car mount, crane, very long lenses, thermal or night cameras;
- is long or heavy: several pages, a long single take, many set-ups, a full day on its own;
- needs a distinctive location that has to be found, permitted and booked: a palace, an airport, a hospital, a desert far from town, a closed road, a landmark;
- needs visual effects, a crowd, animals, children, vehicles, specific weather or a permit.

Rules:
- Call flagScenes once with everything worth flagging, most serious first. Group scenes that share the same issue.
- Only flag what the scenes actually show. An ordinary dialogue scene is not a flag.
- Title: a few plain words. Detail: what happens and why it matters for the shoot. Needs: what it will take — gear, people, permits, preparation — concrete and short.
- Severity: high = safety risk or a big cost; medium = needs planning or a booking; low = worth knowing.
- If nothing stands out, call flagScenes with an empty list.`;

const flagSchema = z.object({
  flags: z
    .array(
      z.object({
        kind: z.enum(SCENE_FLAG_KINDS),
        severity: z.enum(['high', 'medium', 'low']),
        scenes: z.array(z.number().int().min(0)).min(1).max(20).describe('Scene numbers as given in the list.'),
        title: z.string().min(2).max(80),
        detail: z.string().max(300),
        needs: z.array(z.string().max(100)).max(6),
      }),
    )
    .max(MAX_FLAGS * 2),
});

type FlagResult = { flags: SceneFlag[] };

/**
 * Reads every scene once and flags the ones that stand out. Runs after the
 * breakdown and before the questions, so the producer hears about a car chase
 * or a desert location before it is priced, and can be asked about it.
 *
 * A failure here never sinks the run: the sheet loses its flags, not its budget.
 */
export async function runSceneFlagAgent(
  ctx: RunContext,
  brief: ProjectBrief,
  requirements: SceneRequirement[],
): Promise<SceneFlag[]> {
  const system = withLanguage(SCENE_FLAG_SYSTEM, brief.locale);

  try {
    const extra = await prisma.scene.findMany({
      where: { id: { in: requirements.map((scene) => scene.sceneId) } },
      select: { id: true, pageEighths: true, bodyExcerpt: true },
    });
    const byId = new Map(extra.map((row) => [row.id, row]));
    const scenes: FlagSceneInput[] = requirements.map((scene) => ({
      ...scene,
      pageEighths: byId.get(scene.sceneId)?.pageEighths ?? null,
      excerpt: byId.get(scene.sceneId)?.bodyExcerpt ?? '',
    }));
    const hints = sceneFlagHints(scenes);

    return await withAgentRun(
      {
        ctx,
        agent: AgentName.ORCHESTRATOR,
        model: MODELS.reasoning,
        systemPrompt: system,
        input: { stage: 'scene-flags', scenes: scenes.length, hints: hints.length, locale: brief.locale },
      },
      async (handle) => {
        ctx.report({ type: 'stage', stage: 'flagging_scenes', pct: 46 });

        const flagScenes = loggedTool(handle, 'flagScenes', {
          description: 'Report the scenes the producer must know about now. Call exactly once; an empty list means nothing stands out.',
          inputSchema: flagSchema,
          execute: async ({ flags }): Promise<FlagResult> => ({
            flags: normaliseFlags(flags, scenes.map((scene) => scene.order)),
          }),
        });

        await generateText({
          model: model('reasoning'),
          system,
          tools: { flagScenes },
          toolChoice: { type: 'tool', toolName: 'flagScenes' },
          stopWhen: stepCountIs(1),
          temperature: 0.2,
          prompt: [
            `Production: "${brief.name}" — ${brief.type}.`,
            brief.synopsis ? `Synopsis: ${brief.synopsis.slice(0, 800)}` : '',
            '',
            hints.length ? `Spotted by code (check and phrase them; add what code cannot see):\n${hints.map((hint) => `- ${hint}`).join('\n')}` : 'Code spotted nothing on its own.',
            '',
            'Scenes:',
            ...scenes.slice(0, 150).map(
              (scene) =>
                `Sc. ${scene.order}: ${scene.heading} | ${scene.environment}, ${scene.time_of_day} | ${scene.camera_movement} | ~${scene.estimated_shoot_hours}h${
                  scene.pageEighths ? `, ${(scene.pageEighths / 8).toFixed(1)}p` : ''
                }${scene.special_requirements.length ? ` | special: ${scene.special_requirements.join(', ')}` : ''}${
                  scene.excerpt ? `\n   ${scene.excerpt.replace(/\s+/g, ' ').slice(0, 220)}` : ''
                }`,
            ),
          ]
            .filter(Boolean)
            .join('\n'),
        });

        const flagged = lastToolResult<FlagResult>(handle, 'flagScenes');
        return { output: flagged && Array.isArray(flagged.flags) ? flagged.flags : [] };
      },
    );
  } catch (error) {
    ctx.report({
      type: 'log',
      message: `Scene flags skipped: ${error instanceof Error ? error.message : 'unknown error'}`,
    });
    return [];
  }
}

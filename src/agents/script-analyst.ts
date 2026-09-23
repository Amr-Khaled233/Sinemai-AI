import { generateObject, generateText, stepCountIs } from 'ai';
import { z } from 'zod';
import {
  AgentName,
  AgentRunStatus,
  CameraMovement,
  Complexity,
  IntExt,
  TimeOfDay,
} from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { getSettings } from '@/lib/settings';
import { finishRun, lastToolResult, model, MODELS, startRun, type RunContext } from './runtime';
import { makeScriptTools, type ParseResult, type SceneStub } from './tools/script-tools';
import type { ProjectBrief, SceneRequirement, SceneSummary } from './types';

export const SCRIPT_ANALYST_SYSTEM = `You are a professional film production breakdown assistant. You understand cinematography and production terminology (ISO, focal length, anamorphic vs spherical, key light, fill light, practicals, dynamic range, frame rate, handheld vs steadicam vs gimbal, day-for-night, VFX plates).
For each scene provided, output ONLY valid JSON with these fields:
- lighting_complexity: "low" | "medium" | "high"
- lighting_notes: short string (e.g. "single practical light source, low-key")
- camera_movement: "static" | "handheld" | "steadicam/gimbal" | "crane/dolly" | "drone"
- time_of_day: "day" | "night" | "dawn/dusk"
- environment: "interior" | "exterior"
- special_requirements: array of strings (e.g. ["underwater", "VFX greenscreen", "vehicle mount"])
- estimated_shoot_hours: number
Never include prose outside the JSON. Never invent a scene that wasn't in the input.`;

const PREP_SYSTEM = `You prepare screenplays for breakdown. Call parseScriptFile once to segment the script, then report the scene count. Do not analyse the scenes yourself. Keep your reply to one sentence.`;

const sceneAnalysisSchema = z.object({
  scenes: z.array(
    z.object({
      sceneId: z.string(),
      lighting_complexity: z.enum(['low', 'medium', 'high']),
      lighting_notes: z.string().max(240),
      camera_movement: z.enum(['static', 'handheld', 'steadicam/gimbal', 'crane/dolly', 'drone']),
      time_of_day: z.enum(['day', 'night', 'dawn/dusk']),
      environment: z.enum(['interior', 'exterior']),
      special_requirements: z.array(z.string().max(80)),
      estimated_shoot_hours: z.number().min(0.25).max(24),
    }),
  ),
});

const BATCH_SIZE = 12;

const COMPLEXITY_DB: Record<SceneRequirement['lighting_complexity'], Complexity> = {
  low: Complexity.LOW,
  medium: Complexity.MEDIUM,
  high: Complexity.HIGH,
};
const MOVEMENT_DB: Record<SceneRequirement['camera_movement'], CameraMovement> = {
  static: CameraMovement.STATIC,
  handheld: CameraMovement.HANDHELD,
  'steadicam/gimbal': CameraMovement.STEADICAM_GIMBAL,
  'crane/dolly': CameraMovement.CRANE_DOLLY,
  drone: CameraMovement.DRONE,
};
const TIME_DB: Record<SceneRequirement['time_of_day'], TimeOfDay> = {
  day: TimeOfDay.DAY,
  night: TimeOfDay.NIGHT,
  'dawn/dusk': TimeOfDay.DAWN_DUSK,
};
const ENV_DB: Record<SceneRequirement['environment'], IntExt> = {
  interior: IntExt.INTERIOR,
  exterior: IntExt.EXTERIOR,
};

export type ScriptAnalystOutput = {
  scenes: SceneRequirement[];
  summary: SceneSummary;
};

/**
 * Agent 2 — Script Analyst.
 *
 * Step 1 (tool phase): a cheap agent calls parseScriptFile, so segmentation is
 * deterministic and recorded.
 * Step 2 (reasoning phase): scenes are analysed in batches of 12 with a strict
 * JSON schema, on gpt-4o. Batching keeps a feature-length script inside sane
 * token budgets and lets one bad batch fail without losing the rest.
 */
export async function runScriptAnalyst(
  ctx: RunContext,
  brief: ProjectBrief,
  options: { attempt?: number; criticFlag?: string } = {},
): Promise<ScriptAnalystOutput> {
  const startedAt = Date.now();
  const handle = await startRun({
    ctx,
    agent: AgentName.SCRIPT_ANALYST,
    attempt: options.attempt ?? 1,
    model: MODELS.reasoning,
    systemPrompt: SCRIPT_ANALYST_SYSTEM,
    input: { projectId: brief.projectId, criticFlag: options.criticFlag ?? null },
  });

  try {
    const tools = makeScriptTools(handle, { projectId: brief.projectId });

    ctx.report({ type: 'stage', stage: 'parsing', pct: 8, detail: brief.name });
    await generateText({
      model: model('cheap'),
      system: PREP_SYSTEM,
      tools: { parseScriptFile: tools.parseScriptFile },
      stopWhen: stepCountIs(3),
      prompt: `Project "${brief.name}" (${brief.type}). Segment the uploaded script into scenes.${
        options.criticFlag ? ` A reviewer flagged the previous pass: ${options.criticFlag}` : ''
      }`,
    });

    const parsed = lastToolResult<ParseResult>(handle, 'parseScriptFile');
    if (!parsed || typeof parsed.sceneCount !== 'number' || parsed.sceneCount === 0) {
      throw new Error('SCRIPT_SEGMENTATION_FAILED');
    }
    ctx.report({ type: 'scenes', count: parsed.sceneCount });
    ctx.report({
      type: 'stage',
      stage: 'analyzing_scenes',
      pct: 14,
      detail: `${parsed.sceneCount}`,
    });

    // ---- batched breakdown
    const requirements: SceneRequirement[] = [];
    const stubs = await collectStubs(brief.projectId, tools);
    const batches = chunk(stubs, BATCH_SIZE);

    for (const [index, batch] of batches.entries()) {
      const { object } = await generateObject({
        model: model('reasoning'),
        schema: sceneAnalysisSchema,
        system: SCRIPT_ANALYST_SYSTEM,
        temperature: 0.2,
        prompt: buildBatchPrompt(brief, batch, options.criticFlag),
      });

      const bySceneId = new Map(batch.map((s) => [s.sceneId, s]));
      for (const analysed of object.scenes) {
        const stub = bySceneId.get(analysed.sceneId);
        if (!stub) continue; // guards against an invented scene id
        const { sceneId: _ignored, ...fields } = analysed;
        requirements.push({
          sceneId: stub.sceneId,
          order: stub.order,
          heading: stub.heading,
          ...fields,
          special_requirements: analysed.special_requirements
            .map((s) => s.trim().toLowerCase())
            .filter(Boolean)
            .slice(0, 6),
        });
      }

      ctx.report({
        type: 'stage',
        stage: 'analyzing_scenes',
        pct: 14 + Math.round(((index + 1) / batches.length) * 26),
        detail: `${requirements.length}/${stubs.length}`,
      });
    }

    if (requirements.length === 0) throw new Error('NO_SCENES_ANALYSED');

    await persistSceneRequirements(requirements);
    const summary = await summariseScenes(brief.projectId, requirements);

    await finishRun(handle, {
      status: AgentRunStatus.OK,
      output: { summary, sceneCount: requirements.length },
      startedAt,
    });

    return { scenes: requirements.sort((a, b) => a.order - b.order), summary };
  } catch (error) {
    await finishRun(handle, {
      status: AgentRunStatus.FAILED,
      errorText: error instanceof Error ? error.message : String(error),
      startedAt,
    });
    throw error;
  }
}

async function collectStubs(
  projectId: string,
  tools: ReturnType<typeof makeScriptTools>,
): Promise<SceneStub[]> {
  const stubs: SceneStub[] = [];
  let offset = 0;

  // The segmentScenes tool is the agent's paging interface; calling it directly
  // here keeps the batching loop deterministic while still logging every call.
  for (;;) {
    const result = (await tools.segmentScenes.execute?.(
      { offset, limit: BATCH_SIZE },
      { toolCallId: `segment-${offset}`, messages: [] },
    )) as { scenes: SceneStub[]; nextOffset: number | null } | undefined;
    if (!result || !Array.isArray(result.scenes) || result.scenes.length === 0) break;
    stubs.push(...result.scenes);
    if (result.nextOffset === null) break;
    offset = result.nextOffset;
    if (stubs.length >= 400) break; // hard ceiling for runaway documents
  }

  return stubs;
}

function buildBatchPrompt(brief: ProjectBrief, batch: SceneStub[], criticFlag?: string) {
  const scenes = batch
    .map(
      (scene) =>
        `--- sceneId: ${scene.sceneId}\nHEADING: ${scene.heading}\nParsed: intExt=${
          scene.intExt ?? 'unknown'
        }, timeOfDay=${scene.timeOfDay ?? 'unknown'}, pageEighths=${scene.pageEighths ?? 'unknown'}\nACTION:\n${
          scene.excerpt || '(no action lines)'
        }`,
    )
    .join('\n\n');

  return [
    `Production: "${brief.name}" — ${brief.type}, budget tier ${brief.budgetTier}.`,
    brief.visualStyleTags.length ? `Director's visual style: ${brief.visualStyleTags.join(', ')}.` : '',
    criticFlag ? `A reviewer flagged the previous breakdown: ${criticFlag}. Correct it.` : '',
    `Return one JSON object per scene, echoing its sceneId exactly. Respect the parsed intExt/timeOfDay hints unless the action clearly contradicts them.`,
    '',
    scenes,
  ]
    .filter(Boolean)
    .join('\n');
}

async function persistSceneRequirements(requirements: SceneRequirement[]) {
  await prisma.$transaction(
    requirements.map((r) =>
      prisma.scene.update({
        where: { id: r.sceneId },
        data: {
          lightingComplexity: COMPLEXITY_DB[r.lighting_complexity],
          lightingNotes: r.lighting_notes,
          cameraMovement: MOVEMENT_DB[r.camera_movement],
          timeOfDay: TIME_DB[r.time_of_day],
          intExt: ENV_DB[r.environment],
          specialRequirements: r.special_requirements,
          estimatedHours: r.estimated_shoot_hours,
          analyzedAt: new Date(),
        },
      }),
    ),
  );
}

/** Aggregation is pure arithmetic — no model is asked to count anything. */
export async function summariseScenes(
  projectId: string,
  requirements: SceneRequirement[],
): Promise<SceneSummary> {
  const settings = await getSettings();
  const script = await prisma.script.findUnique({
    where: { projectId },
    select: { pageCount: true },
  });

  const count = requirements.length;
  const lightingMix: Record<Complexity, number> = { LOW: 0, MEDIUM: 0, HIGH: 0 };
  const movementMix: Record<CameraMovement, number> = {
    STATIC: 0,
    HANDHELD: 0,
    STEADICAM_GIMBAL: 0,
    CRANE_DOLLY: 0,
    DRONE: 0,
  };
  const timeMix: Record<TimeOfDay, number> = { DAY: 0, NIGHT: 0, DAWN_DUSK: 0 };
  const environmentMix: Record<IntExt, number> = { INTERIOR: 0, EXTERIOR: 0 };
  const special = new Map<string, number>();
  const notes: Array<{ note: string; weight: number }> = [];
  let totalHours = 0;

  for (const r of requirements) {
    lightingMix[COMPLEXITY_DB[r.lighting_complexity]] += 1;
    movementMix[MOVEMENT_DB[r.camera_movement]] += 1;
    timeMix[TIME_DB[r.time_of_day]] += 1;
    environmentMix[ENV_DB[r.environment]] += 1;
    totalHours += r.estimated_shoot_hours;
    for (const req of r.special_requirements) special.set(req, (special.get(req) ?? 0) + 1);
    if (r.lighting_notes) {
      notes.push({ note: r.lighting_notes, weight: r.lighting_complexity === 'high' ? 3 : 1 });
    }
  }

  const pct = (n: number) => (count ? Math.round((n / count) * 100) : 0);

  return {
    sceneCount: count,
    totalHours: Math.round(totalHours * 10) / 10,
    shootDays: Math.max(1, Math.ceil(totalHours / settings.shootDayHours)),
    pageCount: script?.pageCount ?? 0,
    nightScenePct: pct(timeMix.NIGHT + timeMix.DAWN_DUSK),
    exteriorScenePct: pct(environmentMix.EXTERIOR),
    highComplexityPct: pct(lightingMix.HIGH),
    lightingMix,
    movementMix,
    timeMix,
    environmentMix,
    specialRequirements: [...special.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([key]) => key),
    dominantLightingNotes: notes
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 8)
      .map((n) => n.note),
  };
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

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
import { makeScriptTools, segmentScenesBatch, type ParseResult, type SceneStub } from './tools/script-tools';
import { withLanguage } from './language';
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
Never include prose outside the JSON. Never invent a scene that wasn't in the input.
The enum values above are fixed keys and are always written exactly as listed, in English; only lighting_notes and special_requirements are free text.`;

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

export const BATCH_SIZE = 12;

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

// Reverse maps, for rebuilding requirements from persisted scenes on resume.
const COMPLEXITY_OUT = { LOW: 'low', MEDIUM: 'medium', HIGH: 'high' } as const;
const MOVEMENT_OUT = {
  STATIC: 'static',
  HANDHELD: 'handheld',
  STEADICAM_GIMBAL: 'steadicam/gimbal',
  CRANE_DOLLY: 'crane/dolly',
  DRONE: 'drone',
} as const;
const TIME_OUT = { DAY: 'day', NIGHT: 'night', DAWN_DUSK: 'dawn/dusk' } as const;
const ENV_OUT = { INTERIOR: 'interior', EXTERIOR: 'exterior' } as const;

export type ParsePhaseResult = { sceneTotal: number; reused: boolean };
export type BatchPhaseResult = { analysed: number; sceneTotal: number; nextCursor: number | null };

/**
 * Agent 2 — Script Analyst, in two resumable phases.
 *
 * `parse`: a cheap agent calls parseScriptFile so segmentation is deterministic
 * and recorded.
 * `batch`: one batch of scenes is analysed per call against a strict JSON
 * schema on gpt-4o, and written straight to the Scene rows. Because results are
 * persisted per batch, a timed-out request resumes at the next cursor instead
 * of re-analysing (and re-paying for) the whole script.
 */
export async function runScriptAnalystStep(
  ctx: RunContext,
  brief: ProjectBrief,
  options: { phase: 'parse' } | { phase: 'batch'; cursor: number },
): Promise<ParsePhaseResult & BatchPhaseResult> {
  return options.phase === 'parse'
    ? { ...(await parsePhase(ctx, brief)), analysed: 0, nextCursor: 0 }
    : { ...(await batchPhase(ctx, brief, options.cursor)), reused: false };
}

async function parsePhase(ctx: RunContext, brief: ProjectBrief): Promise<ParsePhaseResult> {
  const startedAt = Date.now();
  const handle = await startRun({
    ctx,
    agent: AgentName.SCRIPT_ANALYST,
    model: MODELS.cheap,
    systemPrompt: PREP_SYSTEM,
    input: { projectId: brief.projectId, phase: 'parse' },
  });

  try {
    const tools = makeScriptTools(handle, { projectId: brief.projectId });

    await generateText({
      model: model('cheap'),
      system: PREP_SYSTEM,
      tools: { parseScriptFile: tools.parseScriptFile },
      stopWhen: stepCountIs(3),
      prompt: `Project "${brief.name}" (${brief.type}). Segment the uploaded script into scenes.`,
    });

    const parsed = lastToolResult<ParseResult>(handle, 'parseScriptFile');
    if (!parsed || typeof parsed.sceneCount !== 'number' || parsed.sceneCount === 0) {
      throw new Error('SCRIPT_SEGMENTATION_FAILED');
    }

    await finishRun(handle, {
      status: AgentRunStatus.OK,
      output: { sceneCount: parsed.sceneCount, reused: parsed.reused },
      startedAt,
    });

    return { sceneTotal: parsed.sceneCount, reused: parsed.reused };
  } catch (error) {
    await finishRun(handle, {
      status: AgentRunStatus.FAILED,
      errorText: error instanceof Error ? error.message : String(error),
      startedAt,
    });
    throw error;
  }
}

async function batchPhase(ctx: RunContext, brief: ProjectBrief, cursor: number): Promise<BatchPhaseResult> {
  const startedAt = Date.now();
  const system = withLanguage(SCRIPT_ANALYST_SYSTEM, brief.locale);
  const handle = await startRun({
    ctx,
    agent: AgentName.SCRIPT_ANALYST,
    attempt: 1,
    model: MODELS.reasoning,
    systemPrompt: system,
    input: { phase: 'batch', cursor, locale: brief.locale },
  });

  try {
    const batch = await segmentScenesBatch(brief.projectId, { offset: cursor, limit: BATCH_SIZE });
    if (batch.scenes.length === 0) {
      await finishRun(handle, { status: AgentRunStatus.OK, output: { empty: true }, startedAt });
      return { analysed: batch.total, sceneTotal: batch.total, nextCursor: null };
    }

    const { object } = await generateObject({
      model: model('reasoning'),
      schema: sceneAnalysisSchema,
      system,
      temperature: 0.2,
      prompt: buildBatchPrompt(brief, batch.scenes),
    });

    const bySceneId = new Map(batch.scenes.map((scene) => [scene.sceneId, scene]));
    const requirements: SceneRequirement[] = [];

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
          .map((value) => value.trim())
          .filter(Boolean)
          .slice(0, 6),
      });
    }

    await persistSceneRequirements(requirements);

    const analysedTotal = await prisma.scene.count({
      where: { script: { projectId: brief.projectId }, analyzedAt: { not: null } },
    });

    await finishRun(handle, {
      status: AgentRunStatus.OK,
      output: { batchSize: requirements.length, cursor, analysedTotal },
      startedAt,
    });

    return {
      analysed: analysedTotal,
      sceneTotal: batch.total,
      nextCursor: batch.nextOffset,
    };
  } catch (error) {
    await finishRun(handle, {
      status: AgentRunStatus.FAILED,
      errorText: error instanceof Error ? error.message : String(error),
      startedAt,
    });
    throw error;
  }
}

function buildBatchPrompt(brief: ProjectBrief, batch: SceneStub[]) {
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
    `Return one JSON object per scene, echoing its sceneId exactly. Respect the parsed intExt/timeOfDay hints unless the action clearly contradicts them.`,
    '',
    scenes,
  ]
    .filter(Boolean)
    .join('\n');
}

async function persistSceneRequirements(requirements: SceneRequirement[]) {
  if (requirements.length === 0) return;
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

/**
 * Rebuilds the requirement set from the persisted scenes. This is what makes
 * the breakdown resumable: the database, not memory, is the source of truth.
 */
export async function loadSceneRequirements(projectId: string): Promise<SceneRequirement[]> {
  const scenes = await prisma.scene.findMany({
    where: { script: { projectId }, analyzedAt: { not: null } },
    orderBy: { order: 'asc' },
    select: {
      id: true,
      order: true,
      heading: true,
      lightingComplexity: true,
      lightingNotes: true,
      cameraMovement: true,
      timeOfDay: true,
      intExt: true,
      specialRequirements: true,
      estimatedHours: true,
    },
  });

  return scenes.map((scene) => ({
    sceneId: scene.id,
    order: scene.order,
    heading: scene.heading,
    lighting_complexity: COMPLEXITY_OUT[scene.lightingComplexity ?? 'MEDIUM'],
    lighting_notes: scene.lightingNotes ?? '',
    camera_movement: MOVEMENT_OUT[scene.cameraMovement ?? 'STATIC'],
    time_of_day: TIME_OUT[scene.timeOfDay ?? 'DAY'],
    environment: ENV_OUT[scene.intExt ?? 'INTERIOR'],
    special_requirements: scene.specialRequirements,
    estimated_shoot_hours: scene.estimatedHours ?? 1,
  }));
}

/**
 * Aggregation is pure arithmetic — no model is asked to count anything.
 *
 * Split from its database wrapper so the numbers every downstream agent reasons
 * over can be tested without a database.
 */
export function aggregateScenes(
  requirements: SceneRequirement[],
  context: { shootDayHours: number; pageCount: number },
): SceneSummary {
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
    shootDays: Math.max(1, Math.ceil(totalHours / context.shootDayHours)),
    pageCount: context.pageCount,
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

/** Database-backed wrapper: reads the configured shoot day length and page count. */
export async function summariseScenes(
  projectId: string,
  requirements: SceneRequirement[],
): Promise<SceneSummary> {
  const [settings, script] = await Promise.all([
    getSettings(),
    prisma.script.findUnique({ where: { projectId }, select: { pageCount: true } }),
  ]);

  return aggregateScenes(requirements, {
    shootDayHours: settings.shootDayHours,
    pageCount: script?.pageCount ?? 0,
  });
}

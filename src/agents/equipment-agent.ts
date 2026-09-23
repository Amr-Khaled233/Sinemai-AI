import { generateObject, generateText, stepCountIs } from 'ai';
import { z } from 'zod';
import { AgentName, AgentRunStatus } from '@prisma/client';
import { allToolResults, finishRun, model, MODELS, startRun, type RunContext } from './runtime';
import { makeEquipmentTools, queryEquipmentCatalog } from './tools/equipment-tools';
import type { CatalogItem, EquipmentResult, PackageItem, ProjectBrief, SceneSummary } from './types';

export const EQUIPMENT_SYSTEM = `You are a camera and lighting department head building a rental package for a production in Saudi Arabia.

Hard rules:
- You may ONLY recommend equipment returned by the queryEquipmentCatalog tool. Never name a camera, lens, light or grip item from your own memory, and never state a spec or a price that did not come back from the tool.
- Query the catalog first. Start with the categories the breakdown actually demands, and issue a second, wider query if a category comes back thin or empty.
- Respect the declared budget tier. Only set includeAdjacentTiers when the strict tier leaves an essential category unfilled, and say so in your rationale.

Think like a department head: night exteriors need output and dynamic range; long handheld days need weight and rigging; a commercial with fast-paced coverage needs a body that reloads and reframes quickly.`;

const SELECTION_SYSTEM = `${EQUIPMENT_SYSTEM}

You are now committing to the package. Choose from the catalog shortlist you retrieved and nothing else. Every item must carry:
- a realistic quantity for a single-unit shoot of this size
- rentalDays no greater than the shoot day count you were given
- a one-line reason tied to the scene statistics (night ratio, lighting complexity, movement mix), not to marketing language

Cover at minimum: one camera body, a lens set, and a lighting package. Add grip/support only when the movement mix demands it.
The rationale must cite concrete numbers from the breakdown, e.g. "62% of scenes are night interiors".`;

const packageSchema = z.object({
  items: z
    .array(
      z.object({
        equipmentId: z.string().describe('Exact id from the catalog shortlist.'),
        quantity: z.number().int().min(1).max(12),
        rentalDays: z.number().int().min(1).max(120),
        reason: z.string().max(200),
      }),
    )
    .min(3)
    .max(18),
  rationale: z.string().min(40).max(1400),
});

export async function runEquipmentAgent(
  ctx: RunContext,
  brief: ProjectBrief,
  summary: SceneSummary,
  options: { attempt?: number; criticFlag?: string } = {},
): Promise<EquipmentResult> {
  const startedAt = Date.now();
  const handle = await startRun({
    ctx,
    agent: AgentName.EQUIPMENT,
    attempt: options.attempt ?? 1,
    model: MODELS.reasoning,
    systemPrompt: EQUIPMENT_SYSTEM,
    input: { summary, budgetTier: brief.budgetTier, criticFlag: options.criticFlag ?? null },
  });

  try {
    ctx.report({ type: 'stage', stage: 'matching_equipment', pct: 46 });

    const tools = makeEquipmentTools(handle, { budgetTier: brief.budgetTier, city: brief.city });

    // ---- phase 1: retrieval. The model picks the filters; the DB picks the gear.
    await generateText({
      model: model('reasoning'),
      system: EQUIPMENT_SYSTEM,
      tools,
      stopWhen: stepCountIs(4),
      temperature: 0.3,
      prompt: buildRetrievalPrompt(brief, summary, options.criticFlag),
    });

    // Union of everything the tool returned across all calls, de-duplicated.
    const retrieved = new Map<string, CatalogItem>();
    for (const result of allToolResults<{ items?: CatalogItem[] }>(handle, 'queryEquipmentCatalog')) {
      for (const item of result.items ?? []) retrieved.set(item.id, item);
    }

    // A silent empty shortlist would push the model toward inventing gear, so we
    // run the deterministic fallback query ourselves instead.
    if (retrieved.size === 0) {
      const fallback = await queryEquipmentCatalog(
        { includeAdjacentTiers: true, limitPerCategory: 5 },
        { budgetTier: brief.budgetTier, city: brief.city },
      );
      for (const item of fallback.items) retrieved.set(item.id, item);
    }
    if (retrieved.size === 0) throw new Error('EMPTY_EQUIPMENT_CATALOG');

    // ---- phase 2: selection, constrained to the retrieved shortlist.
    const shortlist = [...retrieved.values()];
    const { object } = await generateObject({
      model: model('reasoning'),
      schema: packageSchema,
      system: SELECTION_SYSTEM,
      temperature: 0.3,
      prompt: buildSelectionPrompt(brief, summary, shortlist, options.criticFlag),
    });

    // ---- phase 3: enforcement. Anything not in the shortlist is dropped, loudly.
    const dropped: string[] = [];
    const seen = new Set<string>();
    const pkg: PackageItem[] = [];

    for (const item of object.items) {
      const catalogItem = retrieved.get(item.equipmentId);
      if (!catalogItem) {
        dropped.push(item.equipmentId);
        continue;
      }
      if (seen.has(item.equipmentId)) continue;
      seen.add(item.equipmentId);
      pkg.push({
        equipmentId: catalogItem.id,
        categorySlug: catalogItem.categorySlug,
        brand: catalogItem.brand,
        model: catalogItem.model,
        quantity: item.quantity,
        rentalDays: Math.min(item.rentalDays, Math.max(summary.shootDays, 1)),
        reason: item.reason,
      });
    }

    if (pkg.length === 0) throw new Error('NO_VALID_EQUIPMENT_SELECTED');

    const result: EquipmentResult = {
      package: pkg.sort((a, b) => a.categorySlug.localeCompare(b.categorySlug)),
      rationale: object.rationale,
      droppedHallucinatedIds: dropped,
    };

    await finishRun(handle, {
      status: dropped.length ? AgentRunStatus.RETRIED : AgentRunStatus.OK,
      output: { ...result, shortlistSize: shortlist.length },
      criticFlag: dropped.length ? `Dropped ${dropped.length} equipment id(s) not present in the catalog shortlist.` : undefined,
      startedAt,
    });

    return result;
  } catch (error) {
    await finishRun(handle, {
      status: AgentRunStatus.FAILED,
      errorText: error instanceof Error ? error.message : String(error),
      startedAt,
    });
    throw error;
  }
}

function buildRetrievalPrompt(brief: ProjectBrief, summary: SceneSummary, criticFlag?: string) {
  return [
    `Production: "${brief.name}" — ${brief.type}. Budget tier: ${brief.budgetTier}. Shooting in ${brief.city}.`,
    brief.visualStyleTags.length ? `Visual style: ${brief.visualStyleTags.join(', ')}.` : '',
    '',
    'Scene breakdown statistics:',
    describeSummary(summary),
    '',
    criticFlag ? `Reviewer flag on the previous package: ${criticFlag}` : '',
    'Query the catalog for the categories this breakdown requires. Do not name any equipment yet.',
  ]
    .filter(Boolean)
    .join('\n');
}

function buildSelectionPrompt(
  brief: ProjectBrief,
  summary: SceneSummary,
  shortlist: CatalogItem[],
  criticFlag?: string,
) {
  const lines = shortlist.map((item) => {
    const specs = Object.entries(item.specs)
      .slice(0, 5)
      .map(([k, v]) => `${k}: ${String(v)}`)
      .join('; ');
    return [
      `id: ${item.id}`,
      `category: ${item.categorySlug}`,
      `${item.brand} ${item.model}`,
      `tiers: ${item.budgetTier.join('/')}`,
      `lighting: ${item.suitableLightingComplexity.join('/') || '—'}`,
      `movement: ${item.suitableMovementTypes.join('/') || '—'}`,
      `day/night: ${item.dayNightSuitability}`,
      item.specialCapabilities.length ? `capabilities: ${item.specialCapabilities.join('/')}` : '',
      `vendors stocking: ${item.vendorCount}`,
      item.bestDayRate ? `best vendor day rate: ${item.bestDayRate} SAR` : 'no vendor stock yet',
      specs ? `specs: ${specs}` : '',
      item.summaryEn ? `note: ${item.summaryEn}` : '',
    ]
      .filter(Boolean)
      .join(' | ');
  });

  return [
    `Production: "${brief.name}" — ${brief.type}, budget tier ${brief.budgetTier}, ${summary.shootDays} shoot day(s) in ${brief.city}.`,
    brief.visualStyleTags.length ? `Visual style: ${brief.visualStyleTags.join(', ')}.` : '',
    '',
    'Scene breakdown statistics:',
    describeSummary(summary),
    '',
    criticFlag ? `Reviewer flag you must fix: ${criticFlag}` : '',
    '',
    `Catalog shortlist (${shortlist.length} items) — select only from these ids:`,
    ...lines,
  ]
    .filter(Boolean)
    .join('\n');
}

export function describeSummary(summary: SceneSummary) {
  return [
    `- scenes: ${summary.sceneCount}, script pages: ${summary.pageCount}, estimated ${summary.totalHours}h over ${summary.shootDays} shoot day(s)`,
    `- night or dawn/dusk scenes: ${summary.nightScenePct}%`,
    `- exteriors: ${summary.exteriorScenePct}%`,
    `- lighting complexity — low ${summary.lightingMix.LOW}, medium ${summary.lightingMix.MEDIUM}, high ${summary.lightingMix.HIGH} (high = ${summary.highComplexityPct}%)`,
    `- camera movement — static ${summary.movementMix.STATIC}, handheld ${summary.movementMix.HANDHELD}, steadicam/gimbal ${summary.movementMix.STEADICAM_GIMBAL}, crane/dolly ${summary.movementMix.CRANE_DOLLY}, drone ${summary.movementMix.DRONE}`,
    summary.specialRequirements.length
      ? `- special requirements: ${summary.specialRequirements.join(', ')}`
      : '- special requirements: none flagged',
    summary.dominantLightingNotes.length
      ? `- recurring lighting notes: ${summary.dominantLightingNotes.slice(0, 5).join(' / ')}`
      : '',
  ]
    .filter(Boolean)
    .join('\n');
}

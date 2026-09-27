import { generateObject, generateText, stepCountIs } from 'ai';
import { z } from 'zod';
import { AgentName, AgentRunStatus } from '@prisma/client';
import { allToolResults, model, MODELS, withAgentRun, type RunContext } from './runtime';
import { makeEquipmentTools, queryEquipmentCatalog } from './tools/equipment-tools';
import { withLanguage } from './language';
import { describeBudget, describeClarifications } from './clarifications';
import { marketId, type CatalogItem, type EquipmentResult, type PackageItem, type ProjectBrief, type SceneSummary } from './types';

/** The categories the sheet knows how to label; market gear is filed under one of them. */
const CATEGORY_SLUGS = ['camera-body', 'lens', 'lighting', 'grip', 'support', 'sound', 'power', 'drone', 'monitoring', 'other'];

export const EQUIPMENT_SYSTEM = `You are a camera and lighting department head building a rental package for a production in Saudi Arabia.

How to work:
- Choose the gear that serves this script best, from the whole market — cameras, lenses, lighting, grip, sound, drones, anything the scenes need. You are not limited to the platform's catalog.
- Query the platform's catalog first with queryEquipmentCatalog: that gear is bookable here, with real rates from rental companies. When a catalog item fits as well as anything else, prefer it.
- When the right tool is not in the catalog, recommend it anyway from your own knowledge: real, current products only, named exactly (brand and model), with a realistic Saudi rental day rate in SAR. Never invent a product.
- Fit the budget: the tier and the producer's range decide how ambitious the package is.

Think like a department head: night exteriors need output and dynamic range; long handheld days need weight and rigging; a commercial with fast-paced coverage needs a body that reloads and reframes quickly.`;

const SELECTION_SYSTEM = `${EQUIPMENT_SYSTEM}

You are now committing to the package. For each item either give the exact id from the catalog shortlist, or set equipmentId to null and name market gear (brand, model, category, estimatedDayRateSar). Every item must carry:
- a realistic quantity for a single-unit shoot of this size
- rentalDays no greater than the shoot day count you were given
- a one-line reason tied to the scene statistics (night ratio, lighting complexity, movement mix), not to marketing language

Cover at minimum: one camera body, a lens set, and a lighting package. Add grip/support only when the movement mix demands it.
The rationale must cite concrete numbers from the breakdown, e.g. "62% of scenes are night interiors".`;

const packageSchema = z.object({
  items: z
    .array(
      z.object({
        equipmentId: z.string().nullable().describe('Exact id from the catalog shortlist, or null for gear from the wider market.'),
        brand: z.string().max(60).describe('Market gear: the maker. Empty for catalog items.'),
        model: z.string().max(100).describe('Market gear: the exact model. Empty for catalog items.'),
        category: z.string().max(40).describe('Market gear: one of the category slugs given. Empty for catalog items.'),
        estimatedDayRateSar: z.number().nullable().describe('Market gear: a realistic rental day rate in Saudi Arabia, in SAR. Null for catalog items.'),
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
  return withAgentRun(
    {
      ctx,
      agent: AgentName.EQUIPMENT,
      attempt: options.attempt ?? 1,
      model: MODELS.reasoning,
      systemPrompt: withLanguage(EQUIPMENT_SYSTEM, brief.locale),
      input: {
        summary,
        budgetTier: brief.budgetTier,
        locale: brief.locale,
        criticFlag: options.criticFlag ?? null,
      },
    },
    async (handle) => {
      ctx.report({ type: 'stage', stage: 'matching_equipment', pct: 46 });

      const tools = makeEquipmentTools(handle, { budgetTier: brief.budgetTier, city: brief.city });

      // ---- phase 1: retrieval. The model picks the filters; the DB picks the gear.
      await generateText({
        model: model('reasoning'),
        system: withLanguage(EQUIPMENT_SYSTEM, brief.locale),
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

      // ---- phase 2: selection, constrained to the retrieved shortlist.
      const shortlist = [...retrieved.values()];
      const { object } = await generateObject({
        model: model('reasoning'),
        schema: packageSchema,
        system: withLanguage(SELECTION_SYSTEM, brief.locale),
        temperature: 0.3,
        prompt: buildSelectionPrompt(brief, summary, shortlist, options.criticFlag),
      });

      // ---- phase 3: enforcement. Catalog ids must be in the shortlist; market gear must be named and priced.
      const dropped: string[] = [];
      const seen = new Set<string>();
      const pkg: PackageItem[] = [];

      for (const item of object.items) {
        const catalogItem = item.equipmentId ? retrieved.get(item.equipmentId) : undefined;
        if (!catalogItem) {
          // Gear from the wider market: kept when it is named and priced.
          const market = marketItem(item, summary.shootDays);
          if (market && !seen.has(market.equipmentId)) {
            seen.add(market.equipmentId);
            pkg.push(market);
          } else if (!market) {
            dropped.push(item.equipmentId ?? `${item.brand} ${item.model}`.trim());
          }
          continue;
        }
        if (seen.has(catalogItem.id)) continue;
        seen.add(catalogItem.id);
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

      return {
        output: result,
        status: dropped.length ? AgentRunStatus.RETRIED : AgentRunStatus.OK,
        criticFlag: dropped.length
          ? `Dropped ${dropped.length} item(s) that were neither in the catalog shortlist nor named and priced as market gear.`
          : undefined,
      };
    },
  );
}

/** A market pick the sheet can price: named, with a sane day rate. */
function marketItem(
  item: { brand: string; model: string; category: string; estimatedDayRateSar: number | null; quantity: number; rentalDays: number; reason: string },
  shootDays: number,
): PackageItem | null {
  const brand = item.brand.trim();
  const model = item.model.trim();
  const rate = item.estimatedDayRateSar;
  if (!model || !rate || !Number.isFinite(rate) || rate <= 0 || rate > 250_000) return null;
  const category = item.category.trim().toLowerCase();
  return {
    equipmentId: marketId(brand, model),
    categorySlug: CATEGORY_SLUGS.includes(category) ? category : 'other',
    brand,
    model,
    quantity: item.quantity,
    rentalDays: Math.min(item.rentalDays, Math.max(shootDays, 1)),
    reason: item.reason,
    estimatedDayRate: Math.round(rate),
  };
}

function buildRetrievalPrompt(brief: ProjectBrief, summary: SceneSummary, criticFlag?: string) {
  return [
    `Production: "${brief.name}" — ${brief.type}. Budget tier: ${brief.budgetTier}. Shooting in ${brief.city}.`,
    brief.visualStyleTags.length ? `Visual style: ${brief.visualStyleTags.join(', ')}.` : '',
    describeBudget(brief),
    describeClarifications(brief.clarifications),
    '',
    'Scene breakdown statistics:',
    describeSummary(summary),
    '',
    criticFlag ? `Reviewer flag on the previous package: ${criticFlag}` : '',
    'Query the catalog for the categories this breakdown requires, to see what is bookable here. Do not commit to a package yet.',
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
    describeBudget(brief),
    describeClarifications(brief.clarifications),
    '',
    'Scene breakdown statistics:',
    describeSummary(summary),
    '',
    criticFlag ? `Reviewer flag you must fix: ${criticFlag}` : '',
    '',
    `Category slugs for market gear: ${CATEGORY_SLUGS.join(', ')}.`,
    '',
    shortlist.length
      ? `Catalog shortlist (${shortlist.length} items) — bookable on the platform; use these ids when they fit:`
      : 'The catalog has nothing for this production; choose everything from the market.',
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

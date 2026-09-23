import { z } from 'zod';
import { BudgetTier, CameraMovement, Complexity, Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { loggedTool, type AgentRunHandle } from '../runtime';
import type { CatalogItem } from '../types';

/**
 * The Equipment Recommendation Agent's only window onto reality.
 *
 * This is a deterministic database query, not a model call: the agent may only
 * recommend gear that comes back from here. Filtering happens in SQL/Prisma so
 * the same filters always return the same shortlist.
 */

export const catalogFilterSchema = z.object({
  categorySlugs: z
    .array(z.enum(['camera-body', 'lens', 'lighting', 'grip', 'support', 'sound', 'power']))
    .optional()
    .describe('Restrict to these catalog categories. Omit to search every category.'),
  lightingComplexity: z
    .array(z.enum(['low', 'medium', 'high']))
    .optional()
    .describe('Lighting complexity levels the gear must be suitable for.'),
  movementTypes: z
    .array(z.enum(['static', 'handheld', 'steadicam/gimbal', 'crane/dolly', 'drone']))
    .optional()
    .describe('Camera movement types the gear must support.'),
  dayNight: z
    .enum(['day', 'night', 'both'])
    .optional()
    .describe('Day/night suitability required by the majority of scenes.'),
  specialCapabilities: z
    .array(z.string())
    .optional()
    .describe('Special requirements from the scene breakdown, e.g. "underwater", "vehicle mount".'),
  includeAdjacentTiers: z
    .boolean()
    .optional()
    .describe('Include one tier above the project budget tier. Use only when the strict tier returns too little.'),
  limitPerCategory: z.number().int().min(1).max(12).optional(),
});

export type CatalogFilters = z.infer<typeof catalogFilterSchema>;

const COMPLEXITY: Record<string, Complexity> = {
  low: Complexity.LOW,
  medium: Complexity.MEDIUM,
  high: Complexity.HIGH,
};

const MOVEMENT: Record<string, CameraMovement> = {
  static: CameraMovement.STATIC,
  handheld: CameraMovement.HANDHELD,
  'steadicam/gimbal': CameraMovement.STEADICAM_GIMBAL,
  'crane/dolly': CameraMovement.CRANE_DOLLY,
  drone: CameraMovement.DRONE,
};

const TIER_ORDER: BudgetTier[] = [BudgetTier.LOW, BudgetTier.MEDIUM, BudgetTier.HIGH];

function tiersFor(tier: BudgetTier, includeAdjacent?: boolean) {
  if (!includeAdjacent) return [tier];
  const index = TIER_ORDER.indexOf(tier);
  return TIER_ORDER.slice(index, index + 2);
}

export async function queryEquipmentCatalog(
  filters: CatalogFilters,
  context: { budgetTier: BudgetTier; city?: string | null },
): Promise<{ items: CatalogItem[]; totalMatched: number; filtersApplied: CatalogFilters }> {
  const where: Prisma.EquipmentWhereInput = {
    active: true,
    budgetTier: { hasSome: tiersFor(context.budgetTier, filters.includeAdjacentTiers) },
  };

  if (filters.categorySlugs?.length) {
    where.category = { slug: { in: filters.categorySlugs } };
  }
  if (filters.lightingComplexity?.length) {
    where.suitableLightingComplexity = {
      hasSome: filters.lightingComplexity.map((c) => COMPLEXITY[c]).filter(Boolean),
    };
  }
  if (filters.movementTypes?.length) {
    where.suitableMovementTypes = {
      hasSome: filters.movementTypes.map((m) => MOVEMENT[m]).filter(Boolean),
    };
  }
  if (filters.dayNight && filters.dayNight !== 'both') {
    where.dayNightSuitability = { in: [filters.dayNight === 'day' ? 'DAY' : 'NIGHT', 'BOTH'] };
  }
  if (filters.specialCapabilities?.length) {
    // Special requirements widen the shortlist rather than narrowing it: core kit
    // still has to be returned even when only one scene needs a vehicle mount.
    where.OR = [
      { specialCapabilities: { hasSome: filters.specialCapabilities } },
      { isCore: true },
    ];
  }

  const rows = await prisma.equipment.findMany({
    where,
    include: {
      category: { select: { slug: true, nameEn: true, sortOrder: true } },
      inventory: {
        where: { active: true },
        select: { dailyRate: true, city: true, quantityAvailable: true },
      },
    },
    orderBy: [{ category: { sortOrder: 'asc' } }, { isCore: 'desc' }, { brand: 'asc' }],
  });

  const items: CatalogItem[] = rows.map((row) => {
    const stocked = row.inventory.filter((i) => i.quantityAvailable > 0);
    const local = context.city ? stocked.filter((i) => i.city === context.city) : [];
    const pool = local.length ? local : stocked;
    return {
      id: row.id,
      categorySlug: row.category.slug,
      categoryNameEn: row.category.nameEn,
      brand: row.brand,
      model: row.model,
      summaryEn: row.summaryEn,
      specs: (row.specs ?? {}) as Record<string, unknown>,
      budgetTier: row.budgetTier,
      suitableLightingComplexity: row.suitableLightingComplexity,
      suitableMovementTypes: row.suitableMovementTypes,
      dayNightSuitability: row.dayNightSuitability,
      specialCapabilities: row.specialCapabilities,
      indicativeDayRate: row.indicativeDayRate,
      vendorCount: stocked.length,
      bestDayRate: pool.length ? Math.min(...pool.map((i) => i.dailyRate)) : null,
    };
  });

  // Cap per category so a huge lighting catalog cannot crowd out camera bodies
  // in the agent's context window.
  const cap = filters.limitPerCategory ?? 6;
  const perCategory = new Map<string, number>();
  const capped = items.filter((item) => {
    const seen = perCategory.get(item.categorySlug) ?? 0;
    if (seen >= cap) return false;
    perCategory.set(item.categorySlug, seen + 1);
    return true;
  });

  return { items: capped, totalMatched: items.length, filtersApplied: filters };
}

export function makeEquipmentTools(
  handle: AgentRunHandle,
  context: { budgetTier: BudgetTier; city?: string | null },
) {
  return {
    queryEquipmentCatalog: loggedTool(
      handle,
      'queryEquipmentCatalog',
      {
        description:
          'Query the curated equipment catalog. Returns camera bodies, lenses, lighting, grip and support gear that match the given scene requirements and the project budget tier, with vendor stock counts and the best known day rate. This is the ONLY permitted source of equipment names, specs and prices.',
        inputSchema: catalogFilterSchema,
        execute: (filters) => queryEquipmentCatalog(filters, context),
      },
    ),
  };
}

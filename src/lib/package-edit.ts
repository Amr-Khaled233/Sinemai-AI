import 'server-only';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { getSettings } from '@/lib/settings';
import { priceProject } from '@/agents/vendor-budget-agent';
import { getCrewDayRates, queryVendorInventory } from '@/agents/tools/vendor-tools';
import { isMarketItem, marketId, type BudgetBreakdown, type EquipmentResult, type PackageItem, type SceneSummary } from '@/agents/types';
import { snapshotRecommendation } from '@/lib/versions';

export type PackageEditItem = {
  equipmentId: string;
  quantity: number;
  rentalDays: number;
  /** Adding market gear (no catalog id): what it is and an estimated day rate in SAR. */
  market?: { brand: string; model: string; category: string; estimatedDayRate: number };
};

/**
 * Replaces a sheet's equipment package and re-prices it.
 *
 * Re-pricing deliberately does not re-run the agent graph: nothing about the
 * script has changed, so there is nothing for a model to re-reason about. It
 * re-queries vendor stock and crew rates and runs the same `priceProject` the
 * agent used, which keeps an edited sheet arithmetically identical to a
 * generated one and costs nothing. Used by the package editor and by the
 * project chat, so both edit the sheet the same way.
 *
 * Callers check who is asking; this only checks the items.
 */
export async function repricePackage(
  projectId: string,
  items: PackageEditItem[],
  addedReason = 'Added by the producer.',
) {
  if (items.length === 0) throw new Error('PACKAGE_EMPTY');

  const [recommendation, full, settings] = await Promise.all([
    prisma.projectRecommendation.findUnique({ where: { projectId } }),
    prisma.project.findUnique({
      where: { id: projectId },
      select: { city: true, budgetTier: true, shootStartDate: true, shootEndDate: true },
    }),
    getSettings(),
  ]);
  if (!recommendation || !full) throw new Error('NOT_FOUND');

  // Catalog ids must still exist in the catalog; market gear carries its own
  // name and estimate, either from the sheet already or from the edit.
  const catalog = await prisma.equipment.findMany({
    where: { id: { in: items.filter((item) => !isMarketItem(item)).map((item) => item.equipmentId) }, active: true },
    select: { id: true, brand: true, model: true, category: { select: { slug: true } } },
  });
  const byId = new Map(catalog.map((row) => [row.id, row]));

  const previous = (recommendation.equipmentPackage as unknown as PackageItem[]) ?? [];
  const reasons = new Map(previous.map((item) => [item.equipmentId, item.reason]));
  const previousMarket = new Map(previous.filter(isMarketItem).map((item) => [item.equipmentId, item]));

  const packageItems: PackageItem[] = items.flatMap((item) => {
    if (item.market) {
      const rate = Math.round(item.market.estimatedDayRate);
      if (!item.market.model.trim() || !(rate > 0)) return [];
      return [
        {
          equipmentId: marketId(item.market.brand, item.market.model),
          categorySlug: item.market.category || 'other',
          brand: item.market.brand.trim(),
          model: item.market.model.trim(),
          quantity: item.quantity,
          rentalDays: item.rentalDays,
          reason: addedReason,
          estimatedDayRate: rate,
        },
      ];
    }
    if (isMarketItem(item)) {
      const kept = previousMarket.get(item.equipmentId);
      return kept ? [{ ...kept, quantity: item.quantity, rentalDays: item.rentalDays }] : [];
    }
    const row = byId.get(item.equipmentId);
    if (!row) return [];
    return [
      {
        equipmentId: row.id,
        categorySlug: row.category.slug,
        brand: row.brand,
        model: row.model,
        quantity: item.quantity,
        rentalDays: item.rentalDays,
        // An added item has no agent rationale; say so rather than inventing one.
        reason: reasons.get(row.id) ?? addedReason,
      },
    ];
  });
  if (packageItems.length === 0) throw new Error('PACKAGE_EMPTY');

  const equipment: EquipmentResult = {
    package: packageItems,
    rationale: recommendation.equipmentRationale,
    droppedHallucinatedIds: [],
  };

  const iso = (date: Date | null) => (date ? date.toISOString().slice(0, 10) : undefined);
  const [inventory, crew] = await Promise.all([
    queryVendorInventory({
      equipmentIds: packageItems.filter((item) => !isMarketItem(item)).map((item) => item.equipmentId),
      startDate: iso(full.shootStartDate),
      endDate: iso(full.shootEndDate),
      city: full.city,
    }),
    getCrewDayRates({}, { budgetTier: full.budgetTier }),
  ]);

  // Keep the crew the agent chose; the edit is about equipment.
  const previousBudget = recommendation.budgetBreakdown as unknown as BudgetBreakdown | null;
  const selectedRoles = new Set(
    (previousBudget?.crewBreakdown ?? []).map((line) => line.roleSlug),
  );
  const summary = recommendation.sceneSummary as unknown as SceneSummary | null;
  const shootDays = previousBudget?.shootDays ?? summary?.shootDays ?? 1;

  const priced = priceProject({
    equipment,
    inventory,
    crewRates: crew.rates,
    selectedRoles,
    shootDays,
    city: full.city,
    settings,
  });

  // The sheet about to be replaced is worth keeping.
  await snapshotRecommendation(projectId, 'PACKAGE_EDIT');

  await prisma.projectRecommendation.update({
    where: { projectId },
    data: {
      recommendedEquipmentIds: packageItems.filter((item) => !isMarketItem(item)).map((item) => item.equipmentId),
      equipmentPackage: packageItems as unknown as Prisma.InputJsonValue,
      matchedVendors: priced.vendors as unknown as Prisma.InputJsonValue,
      estimatedBudgetLow: priced.low,
      estimatedBudgetMid: priced.mid,
      estimatedBudgetHigh: priced.high,
      budgetBreakdown: {
        ...priced.budget,
        notes: priced.notes,
        uncoveredEquipment: priced.uncoveredEquipment,
      } as unknown as Prisma.InputJsonValue,
      // The reviewer signed off on a package that no longer exists.
      editedAt: new Date(),
    },
  });

  return {
    low: priced.low,
    mid: priced.mid,
    high: priced.high,
    vendors: priced.vendors.length,
    items: packageItems.length,
  };
}

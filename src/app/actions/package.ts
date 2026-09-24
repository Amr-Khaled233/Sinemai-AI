'use server';

import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { getSettings } from '@/lib/settings';
import { priceProject } from '@/agents/vendor-budget-agent';
import { getCrewDayRates, queryVendorInventory } from '@/agents/tools/vendor-tools';
import type { BudgetBreakdown, EquipmentResult, PackageItem, SceneSummary } from '@/agents/types';
import { snapshotRecommendation } from '@/lib/versions';
import { REVALIDATE, requireOwnedProject, revalidate, runAction } from './shared';

/**
 * Editing the recommended package.
 *
 * The agents propose; the producer decides. Dropping a light, adding a second
 * body or cutting a rental from five days to three is the first thing anyone
 * does with a quote, and until now the sheet was read-only.
 *
 * Re-pricing deliberately does not re-run the agent graph: nothing about the
 * script has changed, so there is nothing for a model to re-reason about. It
 * re-queries vendor stock and crew rates and runs the same `priceProject` the
 * agent used, which keeps an edited sheet arithmetically identical to a
 * generated one and costs nothing.
 */

const editSchema = z.object({
  items: z
    .array(
      z.object({
        equipmentId: z.string().min(1),
        quantity: z.coerce.number().int().min(1).max(20),
        rentalDays: z.coerce.number().int().min(1).max(180),
      }),
    )
    .max(40),
});

export type PackageEdit = z.infer<typeof editSchema>['items'][number];

export async function updateEquipmentPackage(projectId: string, items: PackageEdit[]) {
  return runAction('updateEquipmentPackage', async () => {
    const { project } = await requireOwnedProject(projectId);

    const parsed = editSchema.safeParse({ items });
    if (!parsed.success) throw new Error('INVALID_INPUT');
    if (parsed.data.items.length === 0) throw new Error('PACKAGE_EMPTY');

    const [recommendation, full, settings] = await Promise.all([
      prisma.projectRecommendation.findUnique({ where: { projectId } }),
      prisma.project.findUnique({
        where: { id: projectId },
        select: { city: true, budgetTier: true, shootStartDate: true, shootEndDate: true },
      }),
      getSettings(),
    ]);
    if (!recommendation || !full) throw new Error('NOT_FOUND');

    // Every id must still exist in the catalog, so an edited sheet cannot name
    // equipment the platform does not actually know about.
    const catalog = await prisma.equipment.findMany({
      where: { id: { in: parsed.data.items.map((item) => item.equipmentId) }, active: true },
      select: { id: true, brand: true, model: true, category: { select: { slug: true } } },
    });
    const byId = new Map(catalog.map((row) => [row.id, row]));

    const previous = (recommendation.equipmentPackage as unknown as PackageItem[]) ?? [];
    const reasons = new Map(previous.map((item) => [item.equipmentId, item.reason]));

    const packageItems: PackageItem[] = parsed.data.items.flatMap((item) => {
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
          // An item the producer added has no agent rationale; say so rather
          // than inventing one.
          reason: reasons.get(row.id) ?? 'Added by the producer.',
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
        equipmentIds: packageItems.map((item) => item.equipmentId),
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
        recommendedEquipmentIds: packageItems.map((item) => item.equipmentId),
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

    revalidate(REVALIDATE.producerProject, REVALIDATE.producerProjects);
    return { mid: priced.mid, vendors: priced.vendors.length, projectName: project.id };
  });
}

import 'server-only';
import { Prisma, type PrismaClient } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import type { BudgetBreakdown, DopMatch, PackageItem } from '@/agents/types';
import { BASE_CURRENCY, convertSheet, type Fx } from '@/lib/currency';

/**
 * Sheet history.
 *
 * A producer changes the budget tier and re-runs, or edits the package by hand,
 * and then wants to know what that actually cost. Without a snapshot the
 * previous answer is simply gone, so every replacement freezes the outgoing
 * version first.
 */

export type SnapshotReason = 'ANALYSIS' | 'PACKAGE_EDIT';

type Client = PrismaClient | Prisma.TransactionClient;

/**
 * Copies the current sheet into history. Returns the version number written,
 * or null when there is nothing to keep yet.
 *
 * Never throws: losing a snapshot is not a reason to fail the analysis or the
 * edit that triggered it.
 */
export async function snapshotRecommendation(
  projectId: string,
  reason: SnapshotReason,
  client: Client = prisma,
): Promise<number | null> {
  try {
    const current = await client.projectRecommendation.findUnique({ where: { projectId } });
    if (!current) return null;

    const project = await client.project.findUnique({
      where: { id: projectId },
      select: { budgetTier: true },
    });
    if (!project) return null;

    const previous = await client.recommendationVersion.findFirst({
      where: { projectId },
      orderBy: { version: 'desc' },
      select: { version: true },
    });
    const version = (previous?.version ?? 0) + 1;

    await client.recommendationVersion.create({
      data: {
        projectId,
        version,
        reason,
        equipmentPackage: current.equipmentPackage ?? Prisma.JsonNull,
        matchedDops: current.matchedDops ?? Prisma.JsonNull,
        matchedVendors: current.matchedVendors ?? Prisma.JsonNull,
        budgetBreakdown: current.budgetBreakdown ?? Prisma.JsonNull,
        sceneSummary: current.sceneSummary ?? Prisma.JsonNull,
        estimatedBudgetLow: current.estimatedBudgetLow,
        estimatedBudgetMid: current.estimatedBudgetMid,
        estimatedBudgetHigh: current.estimatedBudgetHigh,
        currency: current.currency,
        budgetTier: project.budgetTier,
        criticPassed: current.criticPassed,
        criticNotes: current.criticNotes,
        rationaleText: current.rationaleText,
        generatedAt: current.generatedAt,
      },
    });

    return version;
  } catch (error) {
    console.error(JSON.stringify({ level: 'warning', event: 'snapshot.failed', projectId, reason }));
    void error;
    return null;
  }
}

// ---------------------------------------------------------------- comparison

export type PackageDiffRow = {
  equipmentId: string;
  label: string;
  categorySlug: string;
  change: 'added' | 'removed' | 'changed' | 'same';
  before?: { quantity: number; rentalDays: number };
  after?: { quantity: number; rentalDays: number };
};

export type SheetComparison = {
  left: { label: string; version: number | null; generatedAt: Date; mid: number; currency: string };
  right: { label: string; version: number | null; generatedAt: Date; mid: number; currency: string };
  budget: {
    lowDelta: number;
    midDelta: number;
    highDelta: number;
    equipmentDelta: number;
    crewDelta: number;
    shootDaysDelta: number;
  };
  packageRows: PackageDiffRow[];
  dopsChanged: boolean;
  addedDops: string[];
  removedDops: string[];
};

type Side = {
  label: string;
  version: number | null;
  generatedAt: Date;
  currency: string;
  low: number;
  mid: number;
  high: number;
  equipmentPackage: Prisma.JsonValue;
  matchedDops: Prisma.JsonValue;
  budgetBreakdown: Prisma.JsonValue;
};

function packageOf(value: Prisma.JsonValue): PackageItem[] {
  return (value as unknown as PackageItem[]) ?? [];
}

/** Compares two sheets field by field, so the answer is "what changed", not "here are two sheets". */
export function compareSheets(left: Side, right: Side): SheetComparison {
  const before = new Map(packageOf(left.equipmentPackage).map((item) => [item.equipmentId, item]));
  const after = new Map(packageOf(right.equipmentPackage).map((item) => [item.equipmentId, item]));

  const packageRows: PackageDiffRow[] = [];
  for (const [id, item] of before) {
    const now = after.get(id);
    const row = {
      equipmentId: id,
      label: `${item.brand} ${item.model}`,
      categorySlug: item.categorySlug,
      before: { quantity: item.quantity, rentalDays: item.rentalDays },
    };
    if (!now) {
      packageRows.push({ ...row, change: 'removed' });
    } else if (now.quantity !== item.quantity || now.rentalDays !== item.rentalDays) {
      packageRows.push({
        ...row,
        change: 'changed',
        after: { quantity: now.quantity, rentalDays: now.rentalDays },
      });
    } else {
      packageRows.push({ ...row, change: 'same', after: row.before });
    }
  }
  for (const [id, item] of after) {
    if (before.has(id)) continue;
    packageRows.push({
      equipmentId: id,
      label: `${item.brand} ${item.model}`,
      categorySlug: item.categorySlug,
      change: 'added',
      after: { quantity: item.quantity, rentalDays: item.rentalDays },
    });
  }

  // Changes first: a diff nobody has to scroll through is a diff people read.
  const order = { added: 0, removed: 1, changed: 2, same: 3 } as const;
  packageRows.sort((a, b) => order[a.change] - order[b.change] || a.label.localeCompare(b.label));

  const leftBudget = (left.budgetBreakdown as unknown as BudgetBreakdown) ?? null;
  const rightBudget = (right.budgetBreakdown as unknown as BudgetBreakdown) ?? null;

  const leftDops = ((left.matchedDops as unknown as DopMatch[]) ?? []).map((dop) => dop.name);
  const rightDops = ((right.matchedDops as unknown as DopMatch[]) ?? []).map((dop) => dop.name);

  return {
    left: {
      label: left.label,
      version: left.version,
      generatedAt: left.generatedAt,
      mid: left.mid,
      currency: left.currency,
    },
    right: {
      label: right.label,
      version: right.version,
      generatedAt: right.generatedAt,
      mid: right.mid,
      currency: right.currency,
    },
    budget: {
      lowDelta: right.low - left.low,
      midDelta: right.mid - left.mid,
      highDelta: right.high - left.high,
      equipmentDelta: (rightBudget?.equipmentRental ?? 0) - (leftBudget?.equipmentRental ?? 0),
      crewDelta: (rightBudget?.crewTotal ?? 0) - (leftBudget?.crewTotal ?? 0),
      shootDaysDelta: (rightBudget?.shootDays ?? 0) - (leftBudget?.shootDays ?? 0),
    },
    packageRows,
    dopsChanged: leftDops.join('|') !== rightDops.join('|'),
    addedDops: rightDops.filter((name) => !leftDops.includes(name)),
    removedDops: leftDops.filter((name) => !rightDops.includes(name)),
  };
}

/** Loads a stored version and the live sheet, ready for comparison. */
export async function loadComparison(
  projectId: string,
  versionNumber: number,
  fx: Fx = { code: BASE_CURRENCY, factor: 1 },
) {
  const [storedVersion, storedCurrent] = await Promise.all([
    prisma.recommendationVersion.findUnique({
      where: { projectId_version: { projectId, version: versionNumber } },
    }),
    prisma.projectRecommendation.findUnique({ where: { projectId } }),
  ]);
  if (!storedVersion || !storedCurrent) return null;
  // Both sides in the viewer's currency, so the deltas are too.
  const version = convertSheet(storedVersion, fx);
  const current = convertSheet(storedCurrent, fx);

  return compareSheets(
    {
      label: `v${version.version}`,
      version: version.version,
      generatedAt: version.generatedAt,
      currency: version.currency,
      low: version.estimatedBudgetLow,
      mid: version.estimatedBudgetMid,
      high: version.estimatedBudgetHigh,
      equipmentPackage: version.equipmentPackage,
      matchedDops: version.matchedDops,
      budgetBreakdown: version.budgetBreakdown,
    },
    {
      label: 'current',
      version: null,
      generatedAt: current.generatedAt,
      currency: current.currency,
      low: current.estimatedBudgetLow,
      mid: current.estimatedBudgetMid,
      high: current.estimatedBudgetHigh,
      equipmentPackage: current.equipmentPackage,
      matchedDops: current.matchedDops,
      budgetBreakdown: current.budgetBreakdown,
    },
  );
}

export async function listVersions(projectId: string) {
  return prisma.recommendationVersion.findMany({
    where: { projectId },
    orderBy: { version: 'desc' },
    select: {
      version: true,
      reason: true,
      generatedAt: true,
      createdAt: true,
      estimatedBudgetMid: true,
      currency: true,
      budgetTier: true,
    },
  });
}

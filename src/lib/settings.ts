import { BudgetTier } from '@prisma/client';
import { prisma } from '@/lib/prisma';

/**
 * Admin-configurable platform settings. Every value has a code default so the
 * platform still works on a freshly pushed database, but the admin dashboard
 * (and the seed) writes real rows that take precedence.
 */

export type PlatformSettings = {
  defaultCity: string;
  currency: string;
  /** Added on top of equipment + crew for the "high" estimate. */
  contingencyPct: number;
  /** Discount applied when a rental spans a full week (vendor weekly rates win when present). */
  weeklyRentalDiscountPct: number;
  /** Below this cosine similarity a DOP match is not shown to the producer. */
  dopMatchMinScore: number;
  /** How many DOPs the matching agent returns. */
  dopMatchCount: number;
  /** Hours per shoot day used to convert scene hours into shoot days. */
  shootDayHours: number;
};

export const DEFAULT_SETTINGS: PlatformSettings = {
  defaultCity: 'Riyadh',
  currency: 'SAR',
  contingencyPct: 12,
  weeklyRentalDiscountPct: 20,
  dopMatchMinScore: 0.22,
  dopMatchCount: 5,
  shootDayHours: 10,
};

const SETTINGS_KEY = 'platform';

export async function getSettings(): Promise<PlatformSettings> {
  const row = await prisma.setting.findUnique({ where: { key: SETTINGS_KEY } });
  if (!row) return DEFAULT_SETTINGS;
  return { ...DEFAULT_SETTINGS, ...(row.value as Partial<PlatformSettings>) };
}

export async function saveSettings(patch: Partial<PlatformSettings>) {
  const current = await getSettings();
  const value = { ...current, ...patch };
  await prisma.setting.upsert({
    where: { key: SETTINGS_KEY },
    create: { key: SETTINGS_KEY, value },
    update: { value },
  });
  return value;
}

export const DEFAULT_BUDGET_TIERS: Record<
  BudgetTier,
  { minTotal: number; maxTotal: number; labelEn: string; labelAr: string }
> = {
  LOW: { minTotal: 0, maxTotal: 75_000, labelEn: 'Low — up to 75k SAR', labelAr: 'منخفضة — حتى ٧٥ ألف ريال' },
  MEDIUM: {
    minTotal: 75_000,
    maxTotal: 350_000,
    labelEn: 'Medium — 75k to 350k SAR',
    labelAr: 'متوسطة — ٧٥ ألف إلى ٣٥٠ ألف ريال',
  },
  HIGH: {
    minTotal: 350_000,
    maxTotal: 3_000_000,
    labelEn: 'High — 350k SAR and above',
    labelAr: 'مرتفعة — ٣٥٠ ألف ريال وأعلى',
  },
};

export async function getBudgetTierConfig(tier: BudgetTier) {
  const row = await prisma.budgetTierConfig.findUnique({ where: { tier } });
  if (row) return row;
  const fallback = DEFAULT_BUDGET_TIERS[tier];
  return { tier, currency: 'SAR', updatedAt: new Date(), ...fallback };
}

export async function getBudgetTierConfigs() {
  const rows = await prisma.budgetTierConfig.findMany();
  const byTier = new Map(rows.map((r) => [r.tier, r]));
  return (Object.keys(DEFAULT_BUDGET_TIERS) as BudgetTier[]).map(
    (tier) =>
      byTier.get(tier) ?? {
        tier,
        currency: 'SAR',
        updatedAt: new Date(),
        ...DEFAULT_BUDGET_TIERS[tier],
      },
  );
}

export async function getStyleTags() {
  const tags = await prisma.styleTag.findMany({
    where: { active: true },
    orderBy: [{ sortOrder: 'asc' }, { labelEn: 'asc' }],
  });
  return tags;
}

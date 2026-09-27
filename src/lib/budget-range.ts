import type { BudgetTier } from '@prisma/client';

/**
 * The producer's budget as a range of money.
 *
 * People write budgets every way: "200000", "200k", "٢٠٠ ألف", "1.5 مليون",
 * "100k–300k", "under 100k", "أكثر من مليون". This reads any of those into a
 * SAR range, and derives the internal tier from it — the tier still filters the
 * catalog and the crew rates, but nobody has to pick one any more.
 */

export type BudgetRange = { min: number; max: number };

const EASTERN_DIGITS = '٠١٢٣٤٥٦٧٨٩';

function normalise(text: string) {
  return text
    .replace(/[٠-٩]/g, (digit) => String(EASTERN_DIGITS.indexOf(digit)))
    .replace(/٫/g, '.')
    .replace(/[,،٬](?=\d{3}\b)/g, '')
    .toLowerCase();
}

/** Every amount in the text, with its k / thousand / million multiplier applied. */
function amounts(text: string): number[] {
  const found: number[] = [];
  const pattern = /(\d+(?:\.\d+)?)\s*(k|m|mn|million|thousand|ألف|الف|آلاف|الاف|مليون|ملايين)?/g;
  for (const match of normalise(text).matchAll(pattern)) {
    const value = Number(match[1]);
    const unit = match[2] ?? '';
    const multiplier = /^(m|mn|million|مليون|ملايين)$/.test(unit)
      ? 1_000_000
      : /^(k|thousand|ألف|الف|آلاف|الاف)$/.test(unit)
        ? 1_000
        : 1;
    if (Number.isFinite(value) && value > 0) found.push(Math.round(value * multiplier));
  }
  return found;
}

/**
 * Reads a budget from free text. `toSar` converts from the currency the text is
 * in (the reader's display currency) to SAR. Returns null when there is no
 * amount to read.
 */
export function parseBudgetRange(text: string, toSar: (amount: number) => number = (amount) => amount): BudgetRange | null {
  const values = amounts(text).map(toSar);
  if (values.length === 0) return null;

  const lower = normalise(text);
  const isCeiling = /(under|below|less than|up to|max|أقل من|اقل من|حتى|لحد)/.test(lower);
  const isFloor = /(over|above|more than|at least|أكثر من|اكثر من|فوق|على الأقل)/.test(lower);

  if (values.length >= 2) {
    const [a, b] = [Math.min(values[0], values[1]), Math.max(values[0], values[1])];
    return { min: a, max: b };
  }
  const [value] = values;
  if (isCeiling) return { min: 0, max: value };
  if (isFloor) return { min: value, max: value * 2 };
  // A single figure is a target: allow some room either side.
  return { min: Math.round(value * 0.85), max: Math.round(value * 1.15) };
}

/** The internal tier whose window holds the middle of the range. */
export function tierForRange(
  range: BudgetRange,
  tiers: Array<{ tier: BudgetTier; minTotal: number; maxTotal: number }>,
): BudgetTier {
  const middle = (range.min + range.max) / 2;
  const sorted = [...tiers].sort((a, b) => a.minTotal - b.minTotal);
  const hit = sorted.find((tier) => middle >= tier.minTotal && middle < tier.maxTotal);
  if (hit) return hit.tier;
  return middle < sorted[0].minTotal ? sorted[0].tier : sorted[sorted.length - 1].tier;
}

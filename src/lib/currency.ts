/**
 * Display currencies.
 *
 * Every price in the database is in the base currency (SAR): vendor rates,
 * crew rates, tier windows and every stored sheet. Other currencies exist only
 * at display time, converted with rates the admin sets on the dashboard — the
 * platform never fetches exchange rates on its own, so a number on a sheet is
 * always explainable from what the admin entered.
 *
 * This module is pure (no database, no request) so the conversion can be
 * tested directly; `currency-server.ts` reads the config and the viewer's
 * choice.
 */

export const BASE_CURRENCY = 'SAR';
export const CURRENCY_COOKIE = 'sinemai-currency';

export type CurrencyRate = {
  /** ISO 4217 code, e.g. USD. */
  code: string;
  /** How many units of this currency one SAR buys. */
  perBase: number;
  enabled: boolean;
};

export type CurrencyConfig = {
  /** What a viewer sees before choosing: SAR or any enabled currency. */
  defaultCode: string;
  rates: CurrencyRate[];
};

/**
 * Starting rates for the two currencies pegged to the dollar, so they are
 * exact rather than a guess that goes stale (SAR 3.75/USD, AED 3.6725/USD).
 * Anything floating is left for the admin to add with a rate they chose.
 */
export const DEFAULT_CURRENCY_CONFIG: CurrencyConfig = {
  defaultCode: BASE_CURRENCY,
  rates: [
    { code: 'USD', perBase: 0.2667, enabled: true },
    { code: 'AED', perBase: 0.9793, enabled: true },
  ],
};

export function isCurrencyCode(code: string) {
  if (!/^[A-Z]{3}$/.test(code)) return false;
  try {
    new Intl.NumberFormat('en', { style: 'currency', currency: code });
    return true;
  } catch {
    return false;
  }
}

/** Currencies a viewer may pick: the base plus every enabled rate. */
export function availableCurrencies(config: CurrencyConfig): string[] {
  return [BASE_CURRENCY, ...config.rates.filter((r) => r.enabled && r.code !== BASE_CURRENCY).map((r) => r.code)];
}

/** The viewer's choice if it is still offered, otherwise the admin default. */
export function resolveCurrency(config: CurrencyConfig, requested: string | null | undefined): string {
  const offered = availableCurrencies(config);
  if (requested && offered.includes(requested)) return requested;
  return offered.includes(config.defaultCode) ? config.defaultCode : BASE_CURRENCY;
}

function unitsPerBase(config: CurrencyConfig, code: string): number | null {
  if (code === BASE_CURRENCY) return 1;
  const rate = config.rates.find((r) => r.code === code);
  return rate && rate.perBase > 0 ? rate.perBase : null;
}

/** A conversion from one currency to the display currency. */
export type Fx = { code: string; factor: number };

/**
 * The factor that turns an amount in `from` into `to`. When either side has no
 * usable rate the amount stays in its own currency rather than being shown
 * under the wrong symbol.
 */
export function fxFor(config: CurrencyConfig, from: string, to: string): Fx {
  const source = unitsPerBase(config, from);
  const target = unitsPerBase(config, to);
  if (!source || !target) return { code: from, factor: 1 };
  return { code: to, factor: target / source };
}

export function convert(amount: number, fx: Fx): number {
  return Math.round(amount * fx.factor);
}

/** Converts an optional amount, keeping null and undefined as they were. */
function convertNullable<T extends number | null | undefined>(amount: T, fx: Fx): T {
  return (typeof amount === 'number' ? convert(amount, fx) : amount) as T;
}

// ------------------------------------------------------------------ sheets

type MoneyLine = { dayRate: number; total: number };
type VendorItem = { dailyRate: number; weeklyRate: number | null; lineTotal: number };
type Vendor = { subtotal: number; items: VendorItem[] };
type Dop = { dayRate: number | null };
type Breakdown = {
  currency?: string;
  equipmentRental?: number;
  equipmentUncovered?: number;
  crewTotal?: number;
  contingency?: number;
  crewBreakdown?: MoneyLine[];
  uncoveredEquipment?: Array<{ fallbackDayRate: number | null }>;
};

/** The money-bearing fields of a stored sheet (a recommendation or a version). */
export type SheetMoney = {
  currency: string;
  estimatedBudgetLow: number;
  estimatedBudgetMid: number;
  estimatedBudgetHigh: number;
  matchedVendors: unknown;
  matchedDops: unknown;
  budgetBreakdown: unknown;
};

/**
 * Returns a copy of a sheet with every amount in the display currency. The
 * JSON columns are converted field by field, by name, rather than by walking
 * every number in the tree, so a count or a percentage can never be scaled by
 * mistake.
 */
export function convertSheet<T extends SheetMoney>(sheet: T, fx: Fx): T {
  if (fx.factor === 1 && fx.code === sheet.currency) return sheet;

  const vendors = Array.isArray(sheet.matchedVendors)
    ? (sheet.matchedVendors as Vendor[]).map((vendor) => ({
        ...vendor,
        subtotal: convert(vendor.subtotal, fx),
        items: (vendor.items ?? []).map((item) => ({
          ...item,
          dailyRate: convert(item.dailyRate, fx),
          weeklyRate: convertNullable(item.weeklyRate, fx),
          lineTotal: convert(item.lineTotal, fx),
        })),
      }))
    : sheet.matchedVendors;

  const dops = Array.isArray(sheet.matchedDops)
    ? (sheet.matchedDops as Dop[]).map((dop) => ({ ...dop, dayRate: convertNullable(dop.dayRate, fx) }))
    : sheet.matchedDops;

  const raw = (sheet.budgetBreakdown ?? {}) as Breakdown;
  const breakdown: Breakdown = {
    ...raw,
    currency: fx.code,
    equipmentRental: convertNullable(raw.equipmentRental, fx),
    equipmentUncovered: convertNullable(raw.equipmentUncovered, fx),
    crewTotal: convertNullable(raw.crewTotal, fx),
    contingency: convertNullable(raw.contingency, fx),
    crewBreakdown: raw.crewBreakdown?.map((line) => ({
      ...line,
      dayRate: convert(line.dayRate, fx),
      total: convert(line.total, fx),
    })),
    uncoveredEquipment: raw.uncoveredEquipment?.map((item) => ({
      ...item,
      fallbackDayRate: convertNullable(item.fallbackDayRate, fx),
    })),
  };

  return {
    ...sheet,
    currency: fx.code,
    estimatedBudgetLow: convert(sheet.estimatedBudgetLow, fx),
    estimatedBudgetMid: convert(sheet.estimatedBudgetMid, fx),
    estimatedBudgetHigh: convert(sheet.estimatedBudgetHigh, fx),
    matchedVendors: vendors,
    matchedDops: dops,
    budgetBreakdown: breakdown,
  };
}

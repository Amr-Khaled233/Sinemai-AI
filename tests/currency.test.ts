import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  BASE_CURRENCY,
  availableCurrencies,
  convert,
  convertSheet,
  fxFor,
  isCurrencyCode,
  resolveCurrency,
  type CurrencyConfig,
} from '../src/lib/currency';

const config: CurrencyConfig = {
  defaultCode: 'USD',
  rates: [
    { code: 'USD', perBase: 0.25, enabled: true },
    { code: 'EUR', perBase: 0.2, enabled: false },
  ],
};

const sheet = {
  currency: 'SAR',
  estimatedBudgetLow: 1000,
  estimatedBudgetMid: 2000,
  estimatedBudgetHigh: 4000,
  matchedVendors: [
    { subtotal: 800, items: [{ dailyRate: 400, weeklyRate: null, lineTotal: 800, quantity: 1, rentalDays: 2 }] },
  ],
  matchedDops: [{ name: 'A', dayRate: 5000, score: 0.8 }, { name: 'B', dayRate: null, score: 0.7 }],
  budgetBreakdown: {
    currency: 'SAR',
    shootDays: 3,
    contingencyPct: 12,
    equipmentRental: 800,
    equipmentUncovered: 0,
    crewTotal: 1000,
    contingency: 216,
    crewBreakdown: [{ roleSlug: 'dop', headcount: 1, days: 2, dayRate: 500, total: 1000 }],
    uncoveredEquipment: [{ equipmentId: 'x', fallbackDayRate: 120 }],
  },
  rationaleText: 'untouched',
};

describe('currency choice', () => {
  it('offers SAR plus the enabled rates only', () => {
    assert.deepEqual(availableCurrencies(config), ['SAR', 'USD']);
  });

  it('honours an offered choice and falls back to the default otherwise', () => {
    assert.equal(resolveCurrency(config, 'SAR'), 'SAR');
    assert.equal(resolveCurrency(config, 'EUR'), 'USD', 'a disabled currency is not honoured');
    assert.equal(resolveCurrency(config, 'XYZ'), 'USD');
    assert.equal(resolveCurrency(config, undefined), 'USD');
  });

  it('falls back to SAR when the default itself was disabled', () => {
    assert.equal(resolveCurrency({ ...config, defaultCode: 'EUR' }, null), BASE_CURRENCY);
  });

  it('accepts real ISO codes only', () => {
    assert.equal(isCurrencyCode('EUR'), true);
    assert.equal(isCurrencyCode('eur'), false);
    assert.equal(isCurrencyCode('EURO'), false);
  });
});

describe('conversion', () => {
  it('converts from SAR with the admin rate and rounds', () => {
    assert.equal(convert(1001, fxFor(config, 'SAR', 'USD')), 250);
  });

  it('converts between two non-base currencies through SAR', () => {
    const fx = fxFor(config, 'USD', 'EUR');
    assert.equal(fx.code, 'EUR');
    assert.equal(convert(100, fx), 80);
  });

  it('keeps an amount in its own currency when a rate is missing', () => {
    assert.deepEqual(fxFor(config, 'SAR', 'GBP'), { code: 'SAR', factor: 1 });
  });
});

describe('convertSheet', () => {
  const converted = convertSheet(sheet, fxFor(config, 'SAR', 'USD'));

  it('converts every stored amount and relabels the currency', () => {
    assert.equal(converted.currency, 'USD');
    assert.deepEqual(
      [converted.estimatedBudgetLow, converted.estimatedBudgetMid, converted.estimatedBudgetHigh],
      [250, 500, 1000],
    );
    const vendor = (converted.matchedVendors as typeof sheet.matchedVendors)[0];
    assert.equal(vendor.subtotal, 200);
    assert.deepEqual(
      [vendor.items[0].dailyRate, vendor.items[0].weeklyRate, vendor.items[0].lineTotal],
      [100, null, 200],
    );
    const breakdown = converted.budgetBreakdown as typeof sheet.budgetBreakdown;
    assert.equal(breakdown.currency, 'USD');
    assert.equal(breakdown.crewTotal, 250);
    assert.equal(breakdown.crewBreakdown[0].dayRate, 125);
    assert.equal(breakdown.uncoveredEquipment[0].fallbackDayRate, 30);
  });

  it('never scales counts, days or percentages', () => {
    const vendor = (converted.matchedVendors as typeof sheet.matchedVendors)[0];
    assert.equal(vendor.items[0].quantity, 1);
    assert.equal(vendor.items[0].rentalDays, 2);
    const breakdown = converted.budgetBreakdown as typeof sheet.budgetBreakdown;
    assert.equal(breakdown.shootDays, 3);
    assert.equal(breakdown.contingencyPct, 12);
    assert.equal(breakdown.crewBreakdown[0].headcount, 1);
    const dops = converted.matchedDops as typeof sheet.matchedDops;
    assert.equal(dops[0].score, 0.8);
    assert.equal(dops[0].dayRate, 1250);
    assert.equal(dops[1].dayRate, null);
  });

  it('leaves the original untouched and returns it as-is when nothing changes', () => {
    assert.equal(sheet.estimatedBudgetMid, 2000);
    assert.equal(convertSheet(sheet, fxFor(config, 'SAR', 'SAR')), sheet);
  });
});

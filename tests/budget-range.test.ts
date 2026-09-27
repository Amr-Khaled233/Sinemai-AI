import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseBudgetRange, tierForRange } from '../src/lib/budget-range';

const tiers = [
  { tier: 'LOW' as const, minTotal: 0, maxTotal: 75_000 },
  { tier: 'MEDIUM' as const, minTotal: 75_000, maxTotal: 350_000 },
  { tier: 'HIGH' as const, minTotal: 350_000, maxTotal: 3_000_000 },
];

describe('parseBudgetRange', () => {
  it('reads explicit ranges in any notation', () => {
    assert.deepEqual(parseBudgetRange('100k–300k'), { min: 100_000, max: 300_000 });
    assert.deepEqual(parseBudgetRange('from 300,000 to 150,000 SAR'), { min: 150_000, max: 300_000 });
    assert.deepEqual(parseBudgetRange('من ١٠٠ ألف إلى ٢٥٠ ألف'), { min: 100_000, max: 250_000 });
    assert.deepEqual(parseBudgetRange('1.5 مليون - 2 مليون'), { min: 1_500_000, max: 2_000_000 });
  });

  it('reads ceilings and floors', () => {
    assert.deepEqual(parseBudgetRange('Under 100k SAR'), { min: 0, max: 100_000 });
    assert.deepEqual(parseBudgetRange('أقل من ٥٠ ألف'), { min: 0, max: 50_000 });
    assert.deepEqual(parseBudgetRange('Over 1M'), { min: 1_000_000, max: 2_000_000 });
  });

  it('gives a single figure some room', () => {
    assert.deepEqual(parseBudgetRange('200000'), { min: 170_000, max: 230_000 });
  });

  it('converts from the reader currency', () => {
    assert.deepEqual(parseBudgetRange('10k-20k', (usd) => usd * 3.75), { min: 37_500, max: 75_000 });
  });

  it('returns null when there is no amount', () => {
    assert.equal(parseBudgetRange("I'm not sure yet"), null);
    assert.equal(parseBudgetRange('لا أعرف'), null);
  });
});

describe('tierForRange', () => {
  it('picks the tier holding the middle of the range', () => {
    assert.equal(tierForRange({ min: 0, max: 60_000 }, tiers), 'LOW');
    assert.equal(tierForRange({ min: 100_000, max: 300_000 }, tiers), 'MEDIUM');
    assert.equal(tierForRange({ min: 1_000_000, max: 2_000_000 }, tiers), 'HIGH');
    assert.equal(tierForRange({ min: 5_000_000, max: 9_000_000 }, tiers), 'HIGH');
  });
});

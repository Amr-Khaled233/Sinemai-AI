import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { compareSheets } from '../src/lib/versions';
import type { Prisma } from '@prisma/client';

const item = (over: Record<string, unknown> = {}) => ({
  equipmentId: 'e1',
  categorySlug: 'camera-body',
  brand: 'ARRI',
  model: 'ALEXA Mini',
  quantity: 1,
  rentalDays: 4,
  reason: 'because',
  ...over,
});

const side = (over: Partial<Parameters<typeof compareSheets>[0]> = {}) => ({
  label: 'v1',
  version: 1,
  generatedAt: new Date('2026-09-01'),
  currency: 'SAR',
  low: 50_000,
  mid: 55_000,
  high: 60_000,
  equipmentPackage: [item()] as unknown as Prisma.JsonValue,
  matchedDops: [] as unknown as Prisma.JsonValue,
  budgetBreakdown: {
    shootDays: 4,
    equipmentRental: 20_000,
    equipmentUncovered: 0,
    crewTotal: 30_000,
    crewBreakdown: [],
    contingencyPct: 12,
    contingency: 5_000,
    currency: 'SAR',
  } as unknown as Prisma.JsonValue,
  ...over,
});

describe('sheet comparison', () => {
  it('reports the budget movement with a direction', () => {
    const diff = compareSheets(side(), side({ label: 'current', version: null, mid: 61_000, low: 55_000 }));
    assert.equal(diff.budget.midDelta, 6_000);
    assert.equal(diff.budget.lowDelta, 5_000);
  });

  it('reports a saving as a negative delta', () => {
    const diff = compareSheets(side(), side({ mid: 48_000 }));
    assert.equal(diff.budget.midDelta, -7_000);
  });

  it('spots an item that was removed', () => {
    const diff = compareSheets(
      side(),
      side({ equipmentPackage: [] as unknown as Prisma.JsonValue }),
    );
    const row = diff.packageRows.find((entry) => entry.equipmentId === 'e1');
    assert.equal(row?.change, 'removed');
    assert.equal(row?.after, undefined);
  });

  it('spots an item that was added', () => {
    const diff = compareSheets(
      side({ equipmentPackage: [] as unknown as Prisma.JsonValue }),
      side({ equipmentPackage: [item({ equipmentId: 'e2', model: 'Supreme Primes' })] as unknown as Prisma.JsonValue }),
    );
    const row = diff.packageRows.find((entry) => entry.equipmentId === 'e2');
    assert.equal(row?.change, 'added');
    assert.equal(row?.after?.quantity, 1);
  });

  it('spots a quantity or day change and keeps both sides', () => {
    const diff = compareSheets(
      side(),
      side({ equipmentPackage: [item({ quantity: 2, rentalDays: 6 })] as unknown as Prisma.JsonValue }),
    );
    const row = diff.packageRows.find((entry) => entry.equipmentId === 'e1');
    assert.equal(row?.change, 'changed');
    assert.deepEqual(row?.before, { quantity: 1, rentalDays: 4 });
    assert.deepEqual(row?.after, { quantity: 2, rentalDays: 6 });
  });

  it('marks an untouched line as unchanged rather than dropping it', () => {
    const diff = compareSheets(side(), side());
    assert.equal(diff.packageRows.length, 1);
    assert.equal(diff.packageRows[0].change, 'same');
  });

  it('sorts changes ahead of untouched lines', () => {
    const before = [item(), item({ equipmentId: 'e2', model: 'Primes' })];
    const after = [item(), item({ equipmentId: 'e3', model: 'SkyPanel' })];
    const diff = compareSheets(
      side({ equipmentPackage: before as unknown as Prisma.JsonValue }),
      side({ equipmentPackage: after as unknown as Prisma.JsonValue }),
    );
    // added and removed come first; the untouched camera body sits last.
    assert.equal(diff.packageRows.at(-1)?.change, 'same');
    assert.ok(['added', 'removed'].includes(diff.packageRows[0].change));
  });

  it('reports which cinematographers came and went', () => {
    const diff = compareSheets(
      side({ matchedDops: [{ name: 'Faisal' }, { name: 'Noura' }] as unknown as Prisma.JsonValue }),
      side({ matchedDops: [{ name: 'Noura' }, { name: 'Layla' }] as unknown as Prisma.JsonValue }),
    );
    assert.equal(diff.dopsChanged, true);
    assert.deepEqual(diff.addedDops, ['Layla']);
    assert.deepEqual(diff.removedDops, ['Faisal']);
  });

  it('survives a version stored before a field existed', () => {
    const diff = compareSheets(
      side({ budgetBreakdown: null as unknown as Prisma.JsonValue, matchedDops: null as unknown as Prisma.JsonValue }),
      side(),
    );
    assert.equal(diff.budget.crewDelta, 30_000);
    assert.equal(diff.dopsChanged, false);
  });
});

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { allocatePackage, buildCrewLines, lineCost } from '../src/agents/vendor-budget-agent';
import { aggregateScenes } from '../src/agents/script-analyst';
import type { EquipmentResult, SceneRequirement } from '../src/agents/types';
import type { VendorInventoryResult } from '../src/agents/tools/vendor-tools';

const packageItem = (over: Partial<EquipmentResult['package'][number]> = {}) => ({
  equipmentId: 'e1',
  categorySlug: 'camera-body',
  brand: 'ARRI',
  model: 'ALEXA Mini',
  quantity: 1,
  rentalDays: 4,
  reason: 'because',
  ...over,
});

const vendorRow = (over: Partial<VendorInventoryResult['vendors'][number]> = {}) => ({
  vendorId: 'v1',
  companyName: 'Najd Studios',
  city: 'Riyadh',
  verified: true,
  contactEmail: null,
  phone: null,
  items: [],
  ...over,
});

const stockItem = (over: Partial<VendorInventoryResult['vendors'][number]['items'][number]> = {}) => ({
  equipmentId: 'e1',
  brand: 'ARRI',
  model: 'ALEXA Mini',
  dailyRate: 1000,
  weeklyRate: null,
  monthlyRate: null,
  currency: 'SAR',
  quantityAvailable: 2,
  availableInRange: true,
  blockedQuantity: 0,
  city: 'Riyadh',
  ...over,
});

describe('rental line cost', () => {
  it('charges per day below a week', () => {
    assert.equal(lineCost(1000, null, 4, 1, 20), 4000);
  });

  it('multiplies by quantity', () => {
    assert.equal(lineCost(1000, null, 4, 3, 20), 12000);
  });

  it("uses the vendor's own weekly rate once a week is reached", () => {
    // 7 days at a 5,600 weekly rate, not 7 × 1,000.
    assert.equal(lineCost(1000, 5600, 7, 1, 20), 5600);
  });

  it('bills whole weeks plus leftover days', () => {
    assert.equal(lineCost(1000, 5600, 9, 1, 20), 5600 + 2000);
  });

  it('derives a weekly rate from the configured discount when the vendor has none', () => {
    // 20% off seven days: 7 × 1000 × 0.8 = 5,600.
    assert.equal(lineCost(1000, null, 7, 1, 20), 5600);
  });
});

describe('package allocation', () => {
  const equipment: EquipmentResult = {
    package: [packageItem()],
    rationale: '',
    droppedHallucinatedIds: [],
  };

  it('picks the cheapest vendor for a line', () => {
    const inventory: VendorInventoryResult = {
      vendors: [
        vendorRow({ vendorId: 'expensive', items: [stockItem({ dailyRate: 2000 })] }),
        vendorRow({ vendorId: 'cheap', companyName: 'Red Sea', items: [stockItem({ dailyRate: 900 })] }),
      ],
      requestedIds: ['e1'],
      unstockedIds: [],
      fallbackRates: [],
    };

    const result = allocatePackage(equipment, inventory, { city: 'Riyadh', weeklyDiscountPct: 20 });
    assert.equal(result.vendors.length, 1);
    assert.equal(result.vendors[0].vendorId, 'cheap');
    assert.equal(result.equipmentLow, 3600);
    // The high estimate keeps the most expensive offer, so the spread is real.
    assert.equal(result.equipmentHigh, 8000);
  });

  it('prefers an available vendor over a cheaper one that is booked out', () => {
    const inventory: VendorInventoryResult = {
      vendors: [
        vendorRow({
          vendorId: 'booked',
          items: [stockItem({ dailyRate: 900, availableInRange: false })],
        }),
        vendorRow({ vendorId: 'free', companyName: 'Red Sea', items: [stockItem({ dailyRate: 1000 })] }),
      ],
      requestedIds: ['e1'],
      unstockedIds: [],
      fallbackRates: [],
    };

    const result = allocatePackage(equipment, inventory, { city: 'Riyadh', weeklyDiscountPct: 20 });
    assert.equal(result.vendors[0].vendorId, 'free');
  });

  it('prices an unstocked item from its indicative rate and reports it', () => {
    const inventory: VendorInventoryResult = {
      vendors: [],
      requestedIds: ['e1'],
      unstockedIds: ['e1'],
      fallbackRates: [{ equipmentId: 'e1', brand: 'ARRI', model: 'ALEXA Mini', indicativeDayRate: 500 }],
    };

    const result = allocatePackage(equipment, inventory, { city: 'Riyadh', weeklyDiscountPct: 20 });
    assert.equal(result.uncovered.length, 1);
    assert.equal(result.uncoveredFallbackTotal, 2000);
    assert.equal(result.equipmentLow, 2000);
  });

  it('adds nothing for an item with no rate at all', () => {
    const inventory: VendorInventoryResult = {
      vendors: [],
      requestedIds: ['e1'],
      unstockedIds: ['e1'],
      fallbackRates: [{ equipmentId: 'e1', brand: 'ARRI', model: 'ALEXA Mini', indicativeDayRate: null }],
    };

    const result = allocatePackage(equipment, inventory, { city: 'Riyadh', weeklyDiscountPct: 20 });
    assert.equal(result.equipmentLow, 0);
    assert.equal(result.uncovered[0].fallbackDayRate, null);
  });

  it('reports coverage as a share of the whole package', () => {
    const twoItems: EquipmentResult = {
      package: [packageItem(), packageItem({ equipmentId: 'e2', model: 'Supreme Primes' })],
      rationale: '',
      droppedHallucinatedIds: [],
    };
    const inventory: VendorInventoryResult = {
      vendors: [vendorRow({ items: [stockItem()] })],
      requestedIds: ['e1', 'e2'],
      unstockedIds: ['e2'],
      fallbackRates: [{ equipmentId: 'e2', brand: 'ZEISS', model: 'Supreme Primes', indicativeDayRate: 100 }],
    };

    const result = allocatePackage(twoItems, inventory, { city: 'Riyadh', weeklyDiscountPct: 20 });
    assert.equal(result.vendors[0].coveragePct, 50);
  });
});

describe('crew lines', () => {
  const rates = [
    { roleSlug: 'dop', labelEn: 'DOP', labelAr: 'مدير التصوير', dayRate: 5000, headcount: 1, currency: 'SAR' },
    { roleSlug: 'grip', labelEn: 'Grip', labelAr: 'فني تثبيت', dayRate: 800, headcount: 2, currency: 'SAR' },
  ];

  it('multiplies rate by headcount and days', () => {
    const lines = buildCrewLines(rates, new Set(['dop', 'grip']), 4);
    assert.equal(lines.find((l) => l.roleSlug === 'dop')?.total, 20000);
    assert.equal(lines.find((l) => l.roleSlug === 'grip')?.total, 6400);
  });

  it('keeps only the selected roles', () => {
    const lines = buildCrewLines(rates, new Set(['dop']), 4);
    assert.deepEqual(lines.map((l) => l.roleSlug), ['dop']);
  });

  it('falls back to the full unit rather than budgeting no crew at all', () => {
    const lines = buildCrewLines(rates, new Set(['nonexistent-role']), 4);
    assert.equal(lines.length, 2);
  });
});

describe('scene aggregation', () => {
  const scene = (over: Partial<SceneRequirement> = {}): SceneRequirement => ({
    sceneId: 's1',
    order: 1,
    heading: 'INT. X - DAY',
    lighting_complexity: 'medium',
    lighting_notes: 'soft key',
    camera_movement: 'static',
    time_of_day: 'day',
    environment: 'interior',
    special_requirements: [],
    estimated_shoot_hours: 5,
    ...over,
  });

  it('counts night and dawn scenes together as the night ratio', () => {
    const summary = aggregateScenes(
      [
        scene({ time_of_day: 'night' }),
        scene({ time_of_day: 'dawn/dusk' }),
        scene({ time_of_day: 'day' }),
        scene({ time_of_day: 'day' }),
      ],
      { shootDayHours: 10, pageCount: 7 },
    );
    assert.equal(summary.nightScenePct, 50);
    assert.equal(summary.sceneCount, 4);
  });

  it('rounds shoot days up from total hours', () => {
    const summary = aggregateScenes(
      [scene({ estimated_shoot_hours: 6 }), scene({ estimated_shoot_hours: 6 })],
      { shootDayHours: 10, pageCount: 0 },
    );
    assert.equal(summary.totalHours, 12);
    assert.equal(summary.shootDays, 2);
  });

  it('never reports a zero-day shoot', () => {
    const summary = aggregateScenes([scene({ estimated_shoot_hours: 0.5 })], {
      shootDayHours: 10,
      pageCount: 0,
    });
    assert.equal(summary.shootDays, 1);
  });

  it('ranks special requirements by how often they appear', () => {
    const summary = aggregateScenes(
      [
        scene({ special_requirements: ['vehicle mount', 'rain'] }),
        scene({ special_requirements: ['vehicle mount'] }),
      ],
      { shootDayHours: 10, pageCount: 0 },
    );
    assert.equal(summary.specialRequirements[0], 'vehicle mount');
  });

  it('surfaces high-complexity lighting notes first', () => {
    const summary = aggregateScenes(
      [
        scene({ lighting_complexity: 'low', lighting_notes: 'available light' }),
        scene({ lighting_complexity: 'high', lighting_notes: 'night exterior, HMI through windows' }),
      ],
      { shootDayHours: 10, pageCount: 0 },
    );
    assert.equal(summary.dominantLightingNotes[0], 'night exterior, HMI through windows');
    assert.equal(summary.highComplexityPct, 50);
  });

  it('handles an empty set without dividing by zero', () => {
    const summary = aggregateScenes([], { shootDayHours: 10, pageCount: 0 });
    assert.equal(summary.sceneCount, 0);
    assert.equal(summary.nightScenePct, 0);
    assert.equal(summary.shootDays, 1);
  });
});

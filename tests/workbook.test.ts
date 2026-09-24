import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import unzipper from 'unzipper';
import { buildWorkbook, type WorkbookLabels } from '../src/lib/workbook';
import { buildSchedule, type ScheduleScene } from '../src/lib/schedule';

/**
 * Builds a real workbook and reads it back out of the zip.
 *
 * Asserting on the returned bytes alone would have passed while every tab was
 * named "Sheet1" — the library ignores an unknown property rather than
 * complaining, so only opening the file catches it.
 */

const labels = {
  overview: 'Overview',
  scenes: 'Scenes',
  schedule: 'Schedule',
  equipment: 'Package',
  vendors: 'Vendors',
  budget: 'Budget',
  day: 'Day',
  number: '#',
  heading: 'Heading',
  hours: 'Hours',
  item: 'Item',
  quantity: 'Qty',
  days: 'Days',
  role: 'Role',
} as WorkbookLabels;

const scenes: ScheduleScene[] = [
  {
    id: 's1',
    order: 1,
    heading: 'INT. CAFE - DAY',
    slug: 'CAFE',
    intExt: 'INTERIOR',
    timeOfDay: 'DAY',
    lightingComplexity: 'MEDIUM',
    cameraMovement: 'STATIC',
    estimatedHours: 4,
    specialRequirements: [],
  },
  {
    id: 's2',
    order: 2,
    heading: 'EXT. WAREHOUSE - NIGHT',
    slug: 'WAREHOUSE',
    intExt: 'EXTERIOR',
    timeOfDay: 'NIGHT',
    lightingComplexity: 'HIGH',
    cameraMovement: 'HANDHELD',
    estimatedHours: 6,
    specialRequirements: ['vehicle mount'],
  },
];

function workbookData(locale: 'ar' | 'en') {
  return {
    locale,
    labels: locale === 'ar' ? { ...labels, scenes: 'المشاهد', budget: 'الميزانية' } : labels,
    projectName: locale === 'ar' ? 'توصيل ليلي' : 'Night Delivery',
    projectType: 'Short film',
    budgetTier: 'Medium',
    city: 'Riyadh',
    generatedAt: '2026-09-24',
    currency: 'SAR',
    styleTags: ['night-cinematography'],
    summaryText: 'Four of six scenes are night work.',
    sceneSummary: null,
    scenes: scenes.map((scene) => ({
      order: scene.order,
      heading: scene.heading,
      intExt: scene.intExt,
      timeOfDay: scene.timeOfDay,
      lightingComplexity: scene.lightingComplexity,
      lightingNotes: 'single practical',
      cameraMovement: scene.cameraMovement,
      estimatedHours: scene.estimatedHours,
      specialRequirements: scene.specialRequirements,
    })),
    schedule: buildSchedule(scenes, { shootDayHours: 10 }),
    equipment: [
      {
        equipmentId: 'e1',
        categorySlug: 'camera-body',
        brand: 'ARRI',
        model: 'ALEXA Mini',
        quantity: 1,
        rentalDays: 3,
        reason: 'Dynamic range',
      },
    ],
    equipmentRationale: '50% night.',
    dops: [],
    vendors: [],
    budget: {
      shootDays: 3,
      equipmentRental: 10200,
      equipmentUncovered: 0,
      crewTotal: 39000,
      crewBreakdown: [
        { roleSlug: 'dop', labelEn: 'DOP', labelAr: 'مدير التصوير', headcount: 1, dayRate: 5000, days: 3, total: 15000 },
      ],
      contingencyPct: 12,
      contingency: 5904,
      currency: 'SAR',
    },
    low: 49200,
    mid: 52152,
    high: 55104,
    criticNotes: ['[warning] no grip package'],
  };
}

describe('spreadsheet export', () => {
  let buffer: Buffer;
  let entries: string[];
  let workbookXml: string;
  let sharedStrings: string;

  before(async () => {
    buffer = await buildWorkbook(workbookData('ar'));
    const zip = await unzipper.Open.buffer(buffer);
    entries = zip.files.map((file) => file.path);
    workbookXml = (await zip.files.find((f) => f.path === 'xl/workbook.xml')!.buffer()).toString('utf8');
    const shared = zip.files.find((f) => f.path === 'xl/sharedStrings.xml');
    sharedStrings = shared ? (await shared.buffer()).toString('utf8') : '';
  });

  it('produces a real xlsx container', () => {
    assert.equal(buffer.subarray(0, 2).toString(), 'PK');
    for (const part of ['[Content_Types].xml', 'xl/workbook.xml', 'xl/worksheets/sheet1.xml']) {
      assert.ok(entries.includes(part), `missing ${part}`);
    }
  });

  it('writes one tab per section, named', () => {
    const names = [...workbookXml.matchAll(/<sheet [^>]*name="([^"]+)"/g)].map((match) => match[1]);
    assert.equal(names.length, 6);
    // The regression this test exists for: unnamed tabs fall back to Sheet1..n.
    assert.ok(!names.some((name) => /^Sheet\d+$/.test(name)), `unnamed tabs: ${names.join(', ')}`);
    assert.ok(names.includes('المشاهد'), names.join(', '));
  });

  it('keeps Arabic intact through the zip', () => {
    assert.match(sharedStrings, /توصيل ليلي/);
  });

  it('writes money as numbers so a column still sums', async () => {
    const zip = await unzipper.Open.buffer(buffer);
    const budgetSheet = (await zip.files.find((f) => f.path === 'xl/worksheets/sheet6.xml')!.buffer()).toString(
      'utf8',
    );
    // A numeric cell has no t="s" (shared string) attribute and carries a raw value.
    assert.match(budgetSheet, /<v>15000<\/v>/);
    assert.match(budgetSheet, /<v>52152<\/v>/);
  });

  it('includes every scheduled scene', async () => {
    const zip = await unzipper.Open.buffer(buffer);
    const scheduleSheet = (await zip.files.find((f) => f.path === 'xl/worksheets/sheet3.xml')!.buffer()).toString(
      'utf8',
    );
    // Two scenes plus one header row.
    const rows = [...scheduleSheet.matchAll(/<row /g)].length;
    assert.equal(rows, 3);
  });

  it('builds an English workbook too', async () => {
    const english = await buildWorkbook(workbookData('en'));
    const zip = await unzipper.Open.buffer(english);
    const xml = (await zip.files.find((f) => f.path === 'xl/workbook.xml')!.buffer()).toString('utf8');
    assert.match(xml, /name="Scenes"/);
  });
});

import 'server-only';
import writeXlsxFile from 'write-excel-file/node';
import type { BudgetBreakdown, DopMatch, PackageItem, SceneSummary, VendorMatch } from '@/agents/types';
import type { Schedule } from '@/lib/schedule';
import { safeHttpUrls } from '@/lib/security';

/**
 * Spreadsheet export.
 *
 * Production managers work in spreadsheets, so the sheet leaves as a real
 * workbook rather than a PDF they would have to retype. One tab per section,
 * because a single flattened sheet is what makes people retype it anyway.
 *
 * Numbers are written as numbers, not as formatted strings: a budget column
 * that cannot be summed is worse than no export.
 */

export type WorkbookLabels = {
  overview: string;
  scenes: string;
  schedule: string;
  equipment: string;
  vendors: string;
  budget: string;
  [key: string]: string;
};

export type WorkbookData = {
  locale: string;
  labels: WorkbookLabels;
  projectName: string;
  projectType: string;
  budgetTier: string;
  city: string;
  generatedAt: string;
  currency: string;
  styleTags: string[];
  summaryText: string;
  sceneSummary: SceneSummary | null;
  scenes: Array<{
    order: number;
    heading: string;
    intExt: string | null;
    timeOfDay: string | null;
    lightingComplexity: string | null;
    lightingNotes: string | null;
    cameraMovement: string | null;
    estimatedHours: number | null;
    specialRequirements: string[];
  }>;
  schedule: Schedule;
  equipment: PackageItem[];
  equipmentRationale: string;
  dops: DopMatch[];
  vendors: VendorMatch[];
  budget: BudgetBreakdown | null;
  low: number;
  mid: number;
  high: number;
  criticNotes: string[];
};

type Cell = {
  value?: string | number | null;
  type?: typeof String | typeof Number;
  fontWeight?: 'bold';
  backgroundColor?: string;
  align?: 'left' | 'right' | 'center';
  wrap?: boolean;
  format?: string;
};

const HEADER: Omit<Cell, 'value'> = { fontWeight: 'bold', backgroundColor: '#F3F4F6' };

const text = (value: string | null | undefined): Cell => ({ value: value ?? '', type: String });
const num = (value: number | null | undefined): Cell => ({
  value: value ?? null,
  type: Number,
  align: 'right',
});
const money = (value: number | null | undefined): Cell => ({
  value: value ?? null,
  type: Number,
  align: 'right',
  // Kept as a number with a currency format, so totals still add up.
  format: '#,##0',
});
const header = (values: string[]): Cell[] => values.map((value) => ({ ...HEADER, value, type: String }));

export async function buildWorkbook(data: WorkbookData) {
  const L = data.labels;

  const overview: Cell[][] = [
    [{ ...HEADER, value: L.overview, type: String }, { ...HEADER, value: '', type: String }],
    [text(L.project), text(data.projectName)],
    [text(L.type), text(data.projectType)],
    [text(L.tier), text(data.budgetTier)],
    [text(L.city), text(data.city)],
    [text(L.generatedLabel), text(data.generatedAt)],
    [text(L.style), text(data.styleTags.join(', '))],
    [],
    [text(L.scenes), num(data.sceneSummary?.sceneCount)],
    [text(L.shootDays), num(data.sceneSummary?.shootDays)],
    [text(L.nightPct), num(data.sceneSummary?.nightScenePct)],
    [text(L.exteriorPct), num(data.sceneSummary?.exteriorScenePct)],
    [],
    [text(L.budgetLow), money(data.low)],
    [text(L.budgetMid), money(data.mid)],
    [text(L.budgetHigh), money(data.high)],
    [text(L.currency), text(data.currency)],
    [],
    [text(L.summary), { ...text(data.summaryText), wrap: true }],
    ...data.criticNotes.map((note) => [text(L.reviewer), { ...text(note), wrap: true }]),
  ];

  const scenes: Cell[][] = [
    header([L.number, L.heading, L.environment, L.time, L.lighting, L.movement, L.hours, L.special, L.notesShort]),
    ...data.scenes.map((scene) => [
      num(scene.order),
      text(scene.heading),
      text(scene.intExt),
      text(scene.timeOfDay),
      text(scene.lightingComplexity),
      text(scene.cameraMovement),
      num(scene.estimatedHours),
      text(scene.specialRequirements.join(', ')),
      text(scene.lightingNotes),
    ]),
  ];

  const schedule: Cell[][] = [
    header([L.day, L.unit, L.dayHours, L.locations, L.number, L.heading, L.hours]),
    ...data.schedule.days.flatMap((day) =>
      day.scenes.map((scene, index) => [
        // The day columns are written once per day so a filter on day works.
        index === 0 ? num(day.day) : text(''),
        index === 0 ? text(day.unit) : text(''),
        index === 0 ? num(day.hours) : text(''),
        index === 0 ? text(day.locations.join(' · ')) : text(''),
        num(scene.order),
        text(scene.heading),
        num(scene.estimatedHours),
      ]),
    ),
  ];

  const equipment: Cell[][] = [
    header([L.category, L.item, L.quantity, L.days, L.reason]),
    ...data.equipment.map((item) => [
      text(item.categorySlug),
      text(`${item.brand} ${item.model}`),
      num(item.quantity),
      num(item.rentalDays),
      text(item.reason),
    ]),
    [],
    [text(L.rationale), { ...text(data.equipmentRationale), wrap: true }],
  ];

  const vendors: Cell[][] = [
    header([L.vendor, L.city, L.coverage, L.item, L.quantity, L.days, L.rate, L.total]),
    ...data.vendors.flatMap((vendor) =>
      vendor.items.map((line, index) => [
        index === 0 ? text(vendor.companyName) : text(''),
        index === 0 ? text(vendor.city) : text(''),
        index === 0 ? num(vendor.coveragePct) : text(''),
        text(`${line.brand} ${line.model}`),
        num(line.quantity),
        num(line.rentalDays),
        money(line.dailyRate),
        money(line.lineTotal),
      ]),
    ),
    [],
    ...data.dops.map((dop) => [
      text(L.cinematographer),
      text(dop.name),
      num(Math.round(dop.score * 100)),
      text(dop.city),
      text(dop.styleTags.join(', ')),
      text(safeHttpUrls(dop.portfolioLinks)[0] ?? ''),
      money(dop.dayRate),
      text(''),
    ]),
  ];

  const budget: Cell[][] = [
    header([L.role, L.headcount, L.rate, L.days, L.total]),
    ...(data.budget?.crewBreakdown ?? []).map((line) => [
      text(data.locale === 'ar' ? line.labelAr : line.labelEn),
      num(line.headcount),
      money(line.dayRate),
      num(line.days),
      money(line.total),
    ]),
    [],
    [text(L.equipmentRental), text(''), text(''), text(''), money(data.budget?.equipmentRental)],
    [text(L.crew), text(''), text(''), text(''), money(data.budget?.crewTotal)],
    [text(L.contingency), text(''), text(''), text(''), money(data.budget?.contingency)],
    [{ ...HEADER, value: L.budgetMid, type: String }, text(''), text(''), text(''), { ...money(data.mid), fontWeight: 'bold' }],
  ];

  // v4 takes one object per sheet, each carrying its own data and columns,
  // and returns a handle rather than bytes — toBuffer() is what a Response needs.
  const file = await writeXlsxFile(
    [
      { sheet: L.overview, data: overview, columns: [{ width: 26 }, { width: 70 }] },
      {
        sheet: L.scenes,
        data: scenes,
        columns: [
          { width: 8 }, { width: 48 }, { width: 14 }, { width: 14 }, { width: 14 },
          { width: 18 }, { width: 10 }, { width: 24 }, { width: 36 },
        ],
      },
      {
        sheet: L.schedule,
        data: schedule,
        columns: [
          { width: 8 }, { width: 14 }, { width: 12 }, { width: 34 },
          { width: 8 }, { width: 48 }, { width: 10 },
        ],
      },
      {
        sheet: L.equipment,
        data: equipment,
        columns: [{ width: 16 }, { width: 38 }, { width: 10 }, { width: 10 }, { width: 60 }],
      },
      {
        sheet: L.vendors,
        data: vendors,
        columns: [
          { width: 28 }, { width: 16 }, { width: 12 }, { width: 38 },
          { width: 10 }, { width: 10 }, { width: 14 }, { width: 14 },
        ],
      },
      {
        sheet: L.budget,
        data: budget,
        columns: [{ width: 30 }, { width: 12 }, { width: 14 }, { width: 10 }, { width: 16 }],
      },
    ] as never,
    { buffer: true } as never,
  );

  return (file as unknown as { toBuffer: () => Promise<Buffer> }).toBuffer();
}

import { getSettings } from '@/lib/settings';
import { buildWorkbook, type WorkbookLabels } from '@/lib/workbook';
import { buildSchedule, type ScheduleScene } from '@/lib/schedule';
import { pdfEnum } from '@/pdf/labels';
import {
  authoriseExport,
  exportFileName,
  exportLocale,
  loadSheetForExport,
  throttleExport,
} from '@/lib/sheet-export';
import type { BudgetBreakdown, DopMatch, PackageItem, SceneSummary, VendorMatch } from '@/agents/types';
import messagesAr from '../../../../../../messages/ar.json';
import messagesEn from '../../../../../../messages/en.json';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * Spreadsheet export. Access, language and throttling come from
 * `@/lib/sheet-export`, shared with the PDF route.
 */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const url = new URL(request.url);
  const token = url.searchParams.get('token');

  const project = await loadSheetForExport(id, token);
  if (!project) return new Response('Not found', { status: 404 });

  const denied = await authoriseExport(project);
  if (denied) return denied;

  const throttled = await throttleExport(request, id, 'xlsx', token);
  if (throttled) return throttled;

  const { recommendation } = project;
  const locale = exportLocale(url, recommendation.locale);
  const settings = await getSettings();
  const scenes = project.script?.scenes ?? [];

  // The workbook reuses the UI catalog rather than a second set of strings.
  const sheet = (locale === 'ar' ? messagesAr : messagesEn).sheet as unknown as Record<string, string>;
  const labels: WorkbookLabels = {
    ...sheet,
    overview: sheet.overview,
    scenes: sheet.scenes,
    schedule: sheet.scheduleTab,
    equipment: sheet.equipmentTitle,
    vendors: sheet.vendorsTitle,
    budget: sheet.budgetTitle,
  };

  const buffer = await buildWorkbook({
    locale,
    labels,
    projectName: project.name,
    projectType: pdfEnum(locale, 'type', project.type),
    budgetTier: pdfEnum(locale, 'tier', project.budgetTier),
    city: project.city,
    generatedAt: recommendation.generatedAt.toISOString().slice(0, 10),
    currency: recommendation.currency,
    styleTags: project.visualStyleTags,
    summaryText: recommendation.rationaleText,
    sceneSummary: (recommendation.sceneSummary as unknown as SceneSummary) ?? null,
    scenes: scenes.map((scene) => ({
      order: scene.order,
      heading: scene.heading,
      intExt: scene.intExt ? pdfEnum(locale, 'intExt', scene.intExt) : null,
      timeOfDay: scene.timeOfDay ? pdfEnum(locale, 'time', scene.timeOfDay) : null,
      lightingComplexity: scene.lightingComplexity
        ? pdfEnum(locale, 'complexity', scene.lightingComplexity)
        : null,
      lightingNotes: scene.lightingNotes,
      cameraMovement: scene.cameraMovement ? pdfEnum(locale, 'movement', scene.cameraMovement) : null,
      estimatedHours: scene.estimatedHours,
      specialRequirements: scene.specialRequirements,
    })),
    schedule: buildSchedule(scenes as ScheduleScene[], { shootDayHours: settings.shootDayHours }),
    equipment: (recommendation.equipmentPackage as unknown as PackageItem[]) ?? [],
    equipmentRationale: recommendation.equipmentRationale,
    dops: (recommendation.matchedDops as unknown as DopMatch[]) ?? [],
    vendors: (recommendation.matchedVendors as unknown as VendorMatch[]) ?? [],
    budget: (recommendation.budgetBreakdown as unknown as BudgetBreakdown) ?? null,
    low: recommendation.estimatedBudgetLow,
    mid: recommendation.estimatedBudgetMid,
    high: recommendation.estimatedBudgetHigh,
    criticNotes: recommendation.criticNotes,
  });

  return new Response(new Uint8Array(buffer), {
    headers: {
      'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'content-disposition': `attachment; filename="${encodeURIComponent(
        exportFileName(project.name, 'xlsx'),
      )}"`,
      'cache-control': 'no-store',
    },
  });
}

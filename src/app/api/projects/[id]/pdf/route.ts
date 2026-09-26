import { createElement } from 'react';
import { renderToBuffer } from '@react-pdf/renderer';
import { SheetDocument, type SheetPdfData } from '@/pdf/sheet-document';
import { pdfEnum, pdfLabels } from '@/pdf/labels';
import {
  authoriseExport,
  exportFileName,
  exportLocale,
  loadSheetForExport,
  throttleExport,
} from '@/lib/sheet-export';
import { convertSheet } from '@/lib/currency';
import { displayFx } from '@/lib/currency-server';
import type { BudgetBreakdown, DopMatch, PackageItem, SceneSummary, VendorMatch } from '@/agents/types';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * PDF export, in Arabic or English.
 *
 * Who may download it, in which language, and under what limit is decided by
 * `@/lib/sheet-export`, which the spreadsheet route shares. This file is only
 * concerned with turning the sheet into a PDF.
 */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const url = new URL(request.url);
  const token = url.searchParams.get('token');

  const sheet = await loadSheetForExport(id, token);
  if (!sheet) return new Response('Not found', { status: 404 });

  const denied = await authoriseExport(sheet);
  if (denied) return denied;

  const throttled = await throttleExport(request, id, 'pdf', token);
  if (throttled) return throttled;

  // Exports use the same currency the viewer is looking at.
  const recommendation = convertSheet(sheet.recommendation, await displayFx());
  const locale = exportLocale(url, recommendation.locale);

  const data: SheetPdfData = {
    locale,
    labels: pdfLabels(locale),
    projectName: sheet.name,
    projectType: pdfEnum(locale, 'type', sheet.type),
    budgetTier: pdfEnum(locale, 'tier', sheet.budgetTier),
    city: sheet.city,
    generatedAt: recommendation.generatedAt.toISOString().slice(0, 10),
    currency: recommendation.currency,
    styleTags: sheet.visualStyleTags,
    summaryText: recommendation.rationaleText,
    sceneSummary: (recommendation.sceneSummary as unknown as SceneSummary) ?? null,
    scenes: (sheet.script?.scenes ?? []).map((scene) => ({
      order: scene.order,
      heading: scene.heading,
      intExt: scene.intExt ? pdfEnum(locale, 'intExt', scene.intExt) : null,
      timeOfDay: scene.timeOfDay ? pdfEnum(locale, 'time', scene.timeOfDay) : null,
      lightingComplexity: scene.lightingComplexity
        ? pdfEnum(locale, 'complexity', scene.lightingComplexity)
        : null,
      cameraMovement: scene.cameraMovement ? pdfEnum(locale, 'movement', scene.cameraMovement) : null,
      estimatedHours: scene.estimatedHours,
    })),
    equipment: (recommendation.equipmentPackage as unknown as PackageItem[]) ?? [],
    equipmentRationale: recommendation.equipmentRationale,
    dops: (recommendation.matchedDops as unknown as DopMatch[]) ?? [],
    vendors: (recommendation.matchedVendors as unknown as VendorMatch[]) ?? [],
    budget: (recommendation.budgetBreakdown as unknown as BudgetBreakdown) ?? null,
    low: recommendation.estimatedBudgetLow,
    mid: recommendation.estimatedBudgetMid,
    high: recommendation.estimatedBudgetHigh,
    criticNotes: recommendation.criticNotes,
  };

  // createElement instead of JSX so this stays a plain .ts route handler.
  const element = createElement(SheetDocument, { data }) as unknown as Parameters<typeof renderToBuffer>[0];
  const buffer = await renderToBuffer(element);

  return new Response(new Uint8Array(buffer), {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `inline; filename="${encodeURIComponent(exportFileName(sheet.name, 'pdf'))}"`,
      'cache-control': 'no-store',
    },
  });
}

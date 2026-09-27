import ar from '../../messages/ar.json';
import en from '../../messages/en.json';
import type { PdfLabels } from './sheet-document';

/**
 * The PDF reuses the same message catalog as the UI, so a label is never
 * translated twice. next-intl is request-scoped, so the catalog is read
 * directly instead of through a hook.
 */
const CATALOG = { ar, en } as const;

export function pdfLabels(locale: string): PdfLabels {
  const messages = locale === 'ar' ? CATALOG.ar : CATALOG.en;
  const sheet = messages.sheet;

  return {
    title: sheet.title,
    summary: sheet.summary,
    sceneBreakdown: sheet.sceneBreakdown,
    scenes: sheet.scenes,
    shootDays: sheet.shootDays,
    nightScenes: sheet.nightScenes,
    exteriors: sheet.exteriors,
    highComplexity: sheet.highComplexity,
    heading: sheet.heading,
    environment: sheet.environment,
    time: sheet.time,
    lighting: sheet.lighting,
    movement: sheet.movement,
    equipmentTitle: sheet.equipmentTitle,
    category: sheet.category,
    item: sheet.item,
    quantity: sheet.quantity,
    days: sheet.days,
    reason: sheet.reason,
    vendorsTitle: sheet.vendorsTitle,
    vendorsEmpty: sheet.vendorsEmpty,
    coverage: sheet.coverage,
    budgetTitle: sheet.budgetTitle,
    budgetLow: sheet.budgetLow,
    budgetMid: sheet.budgetMid,
    budgetHigh: sheet.budgetHigh,
    role: sheet.role,
    headcount: sheet.headcount,
    rate: sheet.rate,
    total: sheet.total,
    equipmentRental: sheet.equipmentRental,
    crew: sheet.crew,
    contingency: locale === 'ar' ? 'احتياطي' : 'Contingency',
    reviewer: sheet.reviewer,
    dayRate: sheet.dayRate,
    provenance:
      locale === 'ar'
        ? 'معدات الكتالوج وأسعار إيجارها في هذه الورقة مصدرها قاعدة بيانات المنصة، ومعدات السوق مسعّرة بتقدير المساعد. التقديرات استرشادية وتخضع لتأكيد السعر والتوفر من شركات التأجير في تواريخك.'
        : 'Catalog equipment and its rental rates come from the Sinemai AI database; market equipment is priced from an estimate by the assistant. Estimates are indicative and subject to rental companies confirming prices and availability on your dates.',
  };
}

/** Enum values are rendered as data in the sheet, so the PDF localises them too. */
export function pdfEnum(locale: string, group: 'intExt' | 'time' | 'complexity' | 'movement' | 'type' | 'tier', key: string) {
  const messages = locale === 'ar' ? CATALOG.ar : CATALOG.en;
  const table = messages.enum[group] as Record<string, string>;
  return table?.[key] ?? key;
}

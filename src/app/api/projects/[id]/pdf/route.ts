import { createElement } from 'react';
import { renderToBuffer } from '@react-pdf/renderer';
import { Role } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { auth } from '@/lib/auth';
import { SheetDocument, type SheetPdfData } from '@/pdf/sheet-document';
import { pdfEnum, pdfLabels } from '@/pdf/labels';
import { normaliseLocale } from '@/agents/language';
import type { BudgetBreakdown, DopMatch, PackageItem, SceneSummary, VendorMatch } from '@/agents/types';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * PDF export, in Arabic or English.
 *
 * Language resolution: `?locale=` (the page the reader is on) → the language the
 * sheet's narrative was generated in → Arabic. Accessible to the project owner,
 * an admin, or anyone holding a live share token, so a shared sheet downloads too.
 */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const url = new URL(request.url);
  const token = url.searchParams.get('token');

  const project = await prisma.project.findUnique({
    where: { id },
    include: {
      recommendation: true,
      shareLinks: { where: { revoked: false }, select: { token: true, expiresAt: true } },
      script: {
        select: {
          scenes: {
            orderBy: { order: 'asc' },
            select: {
              order: true,
              heading: true,
              intExt: true,
              timeOfDay: true,
              lightingComplexity: true,
              cameraMovement: true,
              estimatedHours: true,
            },
          },
        },
      },
    },
  });

  if (!project || !project.recommendation) {
    return new Response('Not found', { status: 404 });
  }

  const validToken =
    token &&
    project.shareLinks.some(
      (link) => link.token === token && (!link.expiresAt || link.expiresAt > new Date()),
    );

  if (!validToken) {
    const session = await auth();
    const allowed =
      session?.user && (session.user.id === project.ownerId || session.user.role === Role.ADMIN);
    if (!allowed) return new Response('Forbidden', { status: 403 });
  }

  const recommendation = project.recommendation;
  const locale = normaliseLocale(url.searchParams.get('locale') ?? recommendation.locale);

  const data: SheetPdfData = {
    locale,
    labels: pdfLabels(locale),
    projectName: project.name,
    projectType: pdfEnum(locale, 'type', project.type),
    budgetTier: pdfEnum(locale, 'tier', project.budgetTier),
    city: project.city,
    generatedAt: recommendation.generatedAt.toISOString().slice(0, 10),
    currency: recommendation.currency,
    styleTags: project.visualStyleTags,
    summaryText: recommendation.rationaleText,
    sceneSummary: (recommendation.sceneSummary as unknown as SceneSummary) ?? null,
    scenes: (project.script?.scenes ?? []).map((scene) => ({
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
  const fileName = `sinemai-${project.name.replace(/[^\w؀-ۿ-]+/g, '-').slice(0, 60)}.pdf`;

  return new Response(new Uint8Array(buffer), {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `inline; filename="${encodeURIComponent(fileName)}"`,
      'cache-control': 'no-store',
    },
  });
}

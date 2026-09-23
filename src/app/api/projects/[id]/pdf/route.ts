import { createElement } from 'react';
import { renderToBuffer } from '@react-pdf/renderer';
import { Role } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { auth } from '@/lib/auth';
import { SheetDocument, type SheetPdfData } from '@/pdf/sheet-document';
import type { BudgetBreakdown, DopMatch, PackageItem, SceneSummary, VendorMatch } from '@/agents/types';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * PDF export. Accessible to the project owner, an admin, or anyone holding a
 * live share token (`?token=`), so a shared sheet can be downloaded too.
 */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const token = new URL(request.url).searchParams.get('token');

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
  const data: SheetPdfData = {
    projectName: project.name,
    projectType: project.type.replace('_', ' ').toLowerCase(),
    budgetTier: recommendation ? project.budgetTier.toLowerCase() : project.budgetTier,
    city: project.city,
    generatedAt: recommendation.generatedAt.toISOString().slice(0, 10),
    currency: recommendation.currency,
    styleTags: project.visualStyleTags,
    summaryText: recommendation.rationaleText,
    sceneSummary: (recommendation.sceneSummary as unknown as SceneSummary) ?? null,
    scenes: project.script?.scenes ?? [],
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
      'content-disposition': `inline; filename="${fileName}"`,
      'cache-control': 'no-store',
    },
  });
}

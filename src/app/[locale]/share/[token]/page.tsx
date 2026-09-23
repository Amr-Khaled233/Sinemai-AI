import { notFound } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import { prisma } from '@/lib/prisma';
import { getBudgetTierConfig } from '@/lib/settings';
import { ProductionSheet } from '@/components/sheet/production-sheet';
import type { AppLocale } from '@/i18n/routing';

export const dynamic = 'force-dynamic';

export default async function SharedSheetPage({
  params,
}: {
  params: Promise<{ locale: string; token: string }>;
}) {
  const { locale, token } = await params;
  setRequestLocale(locale as AppLocale);

  const link = await prisma.shareLink.findUnique({
    where: { token },
    include: {
      project: {
        include: {
          recommendation: true,
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
                  lightingNotes: true,
                  cameraMovement: true,
                  specialRequirements: true,
                  estimatedHours: true,
                },
              },
            },
          },
        },
      },
    },
  });

  if (!link || link.revoked) notFound();
  if (link.expiresAt && link.expiresAt < new Date()) notFound();
  if (!link.project.recommendation) notFound();

  // Fire-and-forget: a view counter must never block rendering the sheet.
  void prisma.shareLink.update({ where: { id: link.id }, data: { viewCount: { increment: 1 } } }).catch(() => {});

  const tierWindow = await getBudgetTierConfig(link.project.budgetTier);

  return (
    <ProductionSheet
      locale={locale}
      readOnly
      actions={
        // The token authorises the export too, so a recipient can download the
        // sheet without an account.
        <a
          href={`/api/projects/${link.project.id}/pdf?token=${token}&locale=${locale}`}
          className="btn-secondary text-xs"
          target="_blank"
          rel="noreferrer"
        >
          PDF
        </a>
      }
      project={{
        id: link.project.id,
        name: link.project.name,
        type: link.project.type,
        budgetTier: link.project.budgetTier,
        city: link.project.city,
        visualStyleTags: link.project.visualStyleTags,
      }}
      recommendation={link.project.recommendation}
      scenes={link.project.script?.scenes ?? []}
      tierWindow={tierWindow}
    />
  );
}

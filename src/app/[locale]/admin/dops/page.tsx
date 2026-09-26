import { getTranslations, setRequestLocale } from 'next-intl/server';
import { requireRole } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { Card } from '@/components/ui';
import { ReembedButton } from '@/components/admin/reembed-button';
import { CinematographerManager } from '@/components/admin/cinematographer-manager';
import type { AppLocale } from '@/i18n/routing';

export default async function AdminDopsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale as AppLocale);
  await requireRole('ADMIN', locale);

  const [t, dops, tags] = await Promise.all([
    getTranslations('admin'),
    prisma.dop.findMany({ orderBy: { displayName: 'asc' } }),
    prisma.styleTag.findMany({
      where: { active: true },
      orderBy: { sortOrder: 'asc' },
      select: { slug: true, labelEn: true, labelAr: true },
    }),
  ]);

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-strong">{t('dopsTitle')}</h1>
      <Card subtitle={t('dopsHint')} action={<ReembedButton />}>
        <CinematographerManager
          locale={locale}
          tags={tags}
          rows={dops.map((dop) => ({
            id: dop.id,
            displayName: dop.displayName,
            displayNameAr: dop.displayNameAr,
            bio: dop.bio,
            city: dop.city,
            dayRate: dop.dayRate,
            yearsExperience: dop.yearsExperience,
            portfolioLinks: dop.portfolioLinks,
            styleTags: dop.styleTags,
            active: dop.status === 'APPROVED',
            matchable: dop.embeddedAt !== null,
          }))}
        />
      </Card>
    </div>
  );
}

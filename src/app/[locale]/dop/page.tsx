import { getTranslations, setRequestLocale } from 'next-intl/server';
import { requireRole } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { getStyleTags } from '@/lib/settings';
import { Badge, Card } from '@/components/ui';
import { DopProfileForm } from '@/components/dop/profile-form';
import { formatDate } from '@/lib/utils';
import type { AppLocale } from '@/i18n/routing';

export default async function DopHome({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale as AppLocale);

  const session = await requireRole('DOP', locale);
  const [t, tEnum, tags] = await Promise.all([
    getTranslations('dop'),
    getTranslations('enum'),
    getStyleTags(),
  ]);

  const dop = await prisma.dop.findUnique({
    where: { userId: session.user.id },
    select: {
      displayName: true,
      displayNameAr: true,
      bio: true,
      city: true,
      dayRate: true,
      yearsExperience: true,
      portfolioLinks: true,
      styleTags: true,
      status: true,
      embeddedAt: true,
    },
  });

  if (!dop) return <Card title={t('title')}>No cinematographer profile is attached to this account.</Card>;

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-strong">{t('title')}</h1>
        <div className="flex items-center gap-2">
          <Badge tone={dop.status === 'APPROVED' ? 'green' : dop.status === 'REJECTED' ? 'red' : 'amber'}>
            {tEnum(`approval.${dop.status}`)}
          </Badge>
          {dop.embeddedAt && (
            <span className="text-[11px] text-muted">
              {t('embeddedAt', { date: formatDate(dop.embeddedAt, locale) })}
            </span>
          )}
        </div>
      </div>

      <p
        className={`rounded-lg border p-3 text-xs ${
          dop.status === 'APPROVED'
            ? 'border-info/40 bg-info/10 text-info'
            : 'border-warning/40 bg-warning/10 text-warning'
        }`}
      >
        {dop.status === 'APPROVED' ? t('approved') : t('pending')}
      </p>

      <Card>
        <DopProfileForm
          locale={locale}
          tags={tags.map((tag) => ({ slug: tag.slug, labelEn: tag.labelEn, labelAr: tag.labelAr }))}
          profile={dop}
        />
      </Card>
    </div>
  );
}

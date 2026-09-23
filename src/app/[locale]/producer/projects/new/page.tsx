import { getTranslations, setRequestLocale } from 'next-intl/server';
import { requireRole } from '@/lib/auth';
import { getBudgetTierConfigs, getSettings, getStyleTags } from '@/lib/settings';
import { Card } from '@/components/ui';
import { ProjectForm } from '@/components/producer/project-form';
import { formatMoney } from '@/lib/utils';
import type { AppLocale } from '@/i18n/routing';

export default async function NewProjectPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale as AppLocale);
  await requireRole(['PRODUCER', 'ADMIN'], locale);

  const [t, tags, tiers, settings] = await Promise.all([
    getTranslations('project'),
    getStyleTags(),
    getBudgetTierConfigs(),
    getSettings(),
  ]);

  const tierLabels = Object.fromEntries(
    tiers.map((tier) => [
      tier.tier,
      `${locale === 'ar' ? tier.labelAr : tier.labelEn} · ${formatMoney(tier.minTotal, locale, tier.currency)}–${formatMoney(
        tier.maxTotal,
        locale,
        tier.currency,
      )}`,
    ]),
  );

  return (
    <div className="mx-auto max-w-2xl">
      <Card title={t('newTitle')}>
        <ProjectForm
          locale={locale}
          tags={tags.map((tag) => ({ slug: tag.slug, labelEn: tag.labelEn, labelAr: tag.labelAr }))}
          tierLabels={tierLabels}
          defaultCity={settings.defaultCity}
        />
      </Card>
    </div>
  );
}

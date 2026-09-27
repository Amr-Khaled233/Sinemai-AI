import { getTranslations, setRequestLocale } from 'next-intl/server';
import { BudgetTier, ProjectType } from '@prisma/client';
import { Link } from '@/i18n/routing';
import { requireRole } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { Badge, Card } from '@/components/ui';
import { StartFromScript } from '@/components/producer/start-from-script';
import { formatDate } from '@/lib/utils';
import { moneyFormatter } from '@/lib/currency-server';
import { getBudgetTierConfigs, getSettings, getStyleTags } from '@/lib/settings';
import { cityName } from '@/lib/city-name';
import type { AppLocale } from '@/i18n/routing';

const STATUS_TONE = {
  DRAFT: 'neutral',
  SCRIPT_UPLOADED: 'teal',
  ANALYZING: 'amber',
  READY: 'green',
  FAILED: 'red',
} as const;

/**
 * Home for a user: drop a script to start, and every script so far below.
 */
export default async function ProducerHome({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale as AppLocale);

  const session = await requireRole(['PRODUCER', 'ADMIN'], locale);
  const [t, tEnum, money, tiers, settings, styleTags, projects] = await Promise.all([
    getTranslations('project'),
    getTranslations('enum'),
    moneyFormatter(locale),
    getBudgetTierConfigs(),
    getSettings(),
    getStyleTags(),
    prisma.project.findMany({
      where: { ownerId: session.user.id },
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        name: true,
        type: true,
        budgetTier: true,
        city: true,
        status: true,
        updatedAt: true,
        script: { select: { sceneCount: true } },
        recommendation: { select: { estimatedBudgetMid: true, currency: true } },
      },
    }),
  ]);

  const tierByKey = new Map(tiers.map((tier) => [tier.tier, tier]));

  return (
    <div className="space-y-10">
      <StartFromScript
        defaultCity={cityName(settings.defaultCity, locale)}
        styleTags={styleTags.map((tag) => ({ slug: tag.slug, labelEn: tag.labelEn, labelAr: tag.labelAr }))}
        types={Object.values(ProjectType).map((value) => ({ value, label: tEnum(`type.${value}`) }))}
        tiers={Object.values(BudgetTier).map((value) => {
          const tier = tierByKey.get(value);
          return {
            value,
            label: tEnum(`tier.${value}`),
            hint: tier ? `${money(tier.minTotal, tier.currency)} – ${money(tier.maxTotal, tier.currency)}` : undefined,
          };
        })}
      />

      <section>
        <h2 className="mb-4 text-xl font-semibold text-strong">{t('myScripts')}</h2>
        {projects.length === 0 ? (
          <p className="prose-sheet">{t('noScriptsYet')}</p>
        ) : (
          <Card className="p-0 sm:p-0">
            <div className="table-wrap border-0">
              <table className="grid-table [--grid-cols:minmax(12rem,2fr)_minmax(8rem,1fr)_7rem_6rem_9rem_7.5rem]">
                <thead>
                  <tr>
                    <th>{t('name')}</th>
                    <th>{t('type')}</th>
                    <th>{t('statusLabel')}</th>
                    <th className="text-end">{t('scenes')}</th>
                    <th className="text-end">{t('midEstimate')}</th>
                    <th>{t('updated')}</th>
                  </tr>
                </thead>
                <tbody>
                  {projects.map((project) => (
                    <tr key={project.id}>
                      <td data-label={t('name')}>
                        <Link
                          href={`/producer/projects/${project.id}`}
                          className="font-medium text-strong hover:text-accent"
                          dir="auto"
                        >
                          {project.name}
                        </Link>
                        <span className="block text-[11px] text-muted">
                          {tEnum(`tier.${project.budgetTier}`)} · {cityName(project.city, locale)}
                        </span>
                      </td>
                      <td data-label={t('type')} className="text-muted">
                        {tEnum(`type.${project.type}`)}
                      </td>
                      <td data-label={t('statusLabel')}>
                        <Badge tone={STATUS_TONE[project.status]} pulse={project.status === 'ANALYZING'}>
                          {t(`status.${project.status}`)}
                        </Badge>
                      </td>
                      <td data-label={t('scenes')} className="text-end tabular-nums">
                        {project.script?.sceneCount ?? '—'}
                      </td>
                      <td data-label={t('midEstimate')} className="text-end tabular-nums text-accent">
                        {project.recommendation
                          ? money(project.recommendation.estimatedBudgetMid, project.recommendation.currency)
                          : '—'}
                      </td>
                      <td data-label={t('updated')} className="text-xs text-muted">
                        {formatDate(project.updatedAt, locale)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </section>
    </div>
  );
}

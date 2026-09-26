import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/routing';
import { requireRole } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { Badge, Card, EmptyState, MeterBar, SectionTitle, Stat } from '@/components/ui';
import { AnimatedNumber } from '@/components/motion';
import { formatDate } from '@/lib/utils';
import { moneyFormatter } from '@/lib/currency-server';
import type { BudgetBreakdown, DopMatch, PackageItem, SceneSummary } from '@/agents/types';
import type { AppLocale } from '@/i18n/routing';

/** How many of the producer's most recent projects the summary reads. */
const PROJECT_SCAN_LIMIT = 200;

/**
 * What the producer's own history says about their work.
 *
 * Everything here is counted from sheets already generated — no extra tracking
 * table — so it is exactly as accurate as the sheets themselves.
 */
export default async function ProducerInsightsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale as AppLocale);

  const session = await requireRole(['PRODUCER', 'ADMIN'], locale);
  const [t, tEnum, money] = await Promise.all([
    getTranslations('insights'),
    getTranslations('enum'),
    moneyFormatter(locale),
  ]);

  const projects = await prisma.project.findMany({
    where: { ownerId: session.user.id },
    orderBy: { updatedAt: 'desc' },
    // Each row carries the whole stored sheet, so the scan is capped. The
    // footnote says so rather than quietly showing a partial total.
    take: PROJECT_SCAN_LIMIT,
    select: {
      id: true,
      name: true,
      type: true,
      budgetTier: true,
      city: true,
      status: true,
      updatedAt: true,
      recommendation: {
        select: {
          estimatedBudgetLow: true,
          estimatedBudgetMid: true,
          estimatedBudgetHigh: true,
          currency: true,
          equipmentPackage: true,
          matchedDops: true,
          budgetBreakdown: true,
          sceneSummary: true,
          generatedAt: true,
        },
      },
    },
  });

  const costed = projects.filter((project) => project.recommendation !== null);

  if (costed.length === 0) {
    return (
      <div>
        <SectionTitle hint={t('subtitle')}>{t('title')}</SectionTitle>
        <EmptyState
          title={t('empty')}
          action={
            <Link href="/producer/projects/new" className="btn-primary">
              {t('startProject')}
            </Link>
          }
        />
      </div>
    );
  }

  const currency = costed[0].recommendation!.currency;
  const mids = costed.map((project) => project.recommendation!.estimatedBudgetMid);
  const totalMid = mids.reduce((sum, value) => sum + value, 0);
  const averageMid = Math.round(totalMid / mids.length);

  // Equipment and cinematographers are tallied across every costed sheet, so
  // "what do I actually keep hiring" has an answer.
  const equipmentTally = new Map<string, { label: string; count: number; days: number }>();
  const dopTally = new Map<string, { name: string; count: number; bestScore: number }>();
  const typeTally = new Map<string, number>();
  let shootDays = 0;
  let sceneCount = 0;
  let nightWeighted = 0;

  for (const project of costed) {
    const recommendation = project.recommendation!;
    for (const item of (recommendation.equipmentPackage as unknown as PackageItem[]) ?? []) {
      const key = item.equipmentId;
      const existing = equipmentTally.get(key) ?? {
        label: `${item.brand} ${item.model}`,
        count: 0,
        days: 0,
      };
      existing.count += 1;
      existing.days += item.rentalDays * item.quantity;
      equipmentTally.set(key, existing);
    }

    for (const dop of (recommendation.matchedDops as unknown as DopMatch[]) ?? []) {
      const existing = dopTally.get(dop.dopId) ?? { name: dop.name, count: 0, bestScore: 0 };
      existing.count += 1;
      existing.bestScore = Math.max(existing.bestScore, dop.score);
      dopTally.set(dop.dopId, existing);
    }

    const budget = recommendation.budgetBreakdown as unknown as BudgetBreakdown | null;
    shootDays += budget?.shootDays ?? 0;

    const summary = recommendation.sceneSummary as unknown as SceneSummary | null;
    if (summary) {
      sceneCount += summary.sceneCount;
      nightWeighted += (summary.nightScenePct / 100) * summary.sceneCount;
    }

    typeTally.set(project.type, (typeTally.get(project.type) ?? 0) + 1);
  }

  const topEquipment = [...equipmentTally.values()].sort((a, b) => b.count - a.count).slice(0, 8);
  const topDops = [...dopTally.values()].sort((a, b) => b.count - a.count).slice(0, 6);
  const nightShare = sceneCount > 0 ? Math.round((nightWeighted / sceneCount) * 100) : 0;

  const typeSegments = [...typeTally.entries()].map(([type, count], index) => ({
    label: tEnum(`type.${type}`),
    value: count,
    className: ['bg-accent', 'bg-info', 'bg-warning', 'bg-success', 'bg-danger'][index % 5],
  }));

  return (
    <div className="space-y-6">
      <SectionTitle hint={t('subtitle')}>{t('title')}</SectionTitle>

      <div className="grid grid-cols-2 gap-2.5 sm:gap-3 lg:grid-cols-5">
        <Stat label={t('projectsCosted')} value={<AnimatedNumber value={costed.length} />} />
        <Stat label={t('totalValue')} value={money(totalMid, currency)} />
        <Stat label={t('averageBudget')} value={money(averageMid, currency)} />
        <Stat label={t('shootDays')} value={<AnimatedNumber value={shootDays} />} />
        <Stat label={t('nightShare')} value={`${nightShare}%`} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title={t('topEquipment')} subtitle={t('topEquipmentHint')}>
          {topEquipment.length === 0 ? (
            <p className="prose-sheet">—</p>
          ) : (
            <div className="table-wrap">
              <table className="grid-table grid-table-compact [--grid-cols:minmax(10rem,1fr)_6rem_7rem]">
                <thead>
                  <tr>
                    <th>{t('colEquipment')}</th>
                    <th className="text-end">{t('colProjects')}</th>
                    <th className="text-end">{t('colRentalDays')}</th>
                  </tr>
                </thead>
                <tbody>
                  {topEquipment.map((entry) => (
                    <tr key={entry.label}>
                      <td data-label={t('colEquipment')} className="text-strong">{entry.label}</td>
                      <td data-label={t('colProjects')} className="text-end tabular-nums">{entry.count}</td>
                      <td data-label={t('colRentalDays')} className="text-end tabular-nums">{entry.days}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <div className="space-y-6">
          <Card title={t('projectMix')}>
            <MeterBar segments={typeSegments} />
          </Card>

          <Card title={t('topDops')}>
            {topDops.length === 0 ? (
              <p className="prose-sheet">—</p>
            ) : (
              <div className="table-wrap">
                <table className="grid-table grid-table-compact [--grid-cols:minmax(10rem,1fr)_6rem_7rem]">
                  <thead>
                    <tr>
                      <th>{t('colCinematographer')}</th>
                      <th className="text-end">{t('colProjects')}</th>
                      <th className="text-end">{t('colBestMatch')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topDops.map((entry) => (
                      <tr key={entry.name}>
                        <td data-label={t('colCinematographer')} className="text-strong">{entry.name}</td>
                        <td data-label={t('colProjects')} className="text-end tabular-nums">{entry.count}</td>
                        <td data-label={t('colBestMatch')} className="text-end tabular-nums text-accent">
                          {Math.round(entry.bestScore * 100)}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      </div>

      <Card title={t('byProject')}>
        <div className="table-wrap">
          <table className="grid-table [--grid-cols:minmax(10rem,2fr)_8rem_7rem_9rem_9rem_9rem]">
            <thead>
              <tr>
                <th>{t('project')}</th>
                <th>{t('type')}</th>
                <th>{t('tier')}</th>
                <th className="text-end">{t('low')}</th>
                <th className="text-end">{t('mid')}</th>
                <th className="text-end">{t('high')}</th>
              </tr>
            </thead>
            <tbody>
              {costed.map((project) => {
                const recommendation = project.recommendation!;
                return (
                  <tr key={project.id}>
                    <td data-label={t('project')}>
                      <Link
                        href={`/producer/projects/${project.id}`}
                        className="font-medium text-strong hover:text-accent"
                      >
                        {project.name}
                      </Link>
                      <span className="ms-2 text-[11px] text-muted">
                        {formatDate(recommendation.generatedAt, locale)}
                      </span>
                    </td>
                    <td data-label={t('type')}>{tEnum(`type.${project.type}`)}</td>
                    <td data-label={t('tier')}>
                      <Badge tone="gold">{tEnum(`tier.${project.budgetTier}`)}</Badge>
                    </td>
                    <td data-label={t('low')} className="text-end tabular-nums">
                      {money(recommendation.estimatedBudgetLow, recommendation.currency)}
                    </td>
                    <td data-label={t('mid')} className="text-end tabular-nums text-strong">
                      {money(recommendation.estimatedBudgetMid, recommendation.currency)}
                    </td>
                    <td data-label={t('high')} className="text-end tabular-nums">
                      {money(recommendation.estimatedBudgetHigh, recommendation.currency)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <p className="px-1 text-[11px] leading-6 text-muted/70">
        {t('note')}
        {projects.length === PROJECT_SCAN_LIMIT ? ` ${t('capped', { count: PROJECT_SCAN_LIMIT })}` : ''}
      </p>
    </div>
  );
}

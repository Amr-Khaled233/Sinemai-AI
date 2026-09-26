import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/routing';
import { requireRole } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { countEmbeddableDops } from '@/lib/embeddings';
import { Badge, Card, Stat } from '@/components/ui';
import { AnimatedNumber } from '@/components/motion';
import { formatDate } from '@/lib/utils';
import type { AppLocale } from '@/i18n/routing';

const RUN_TONE = { OK: 'green', RUNNING: 'amber', RETRIED: 'amber', FAILED: 'red' } as const;

export default async function AdminHome({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale as AppLocale);
  await requireRole('ADMIN', locale);

  const [t, tEnum] = await Promise.all([getTranslations('admin'), getTranslations('enum')]);

  const [
    projectCount,
    readyCount,
    vendorsApproved,
    vendorsPending,
    dopsApproved,
    dopsPending,
    embedded,
    recommendations,
    recentRuns,
  ] = await Promise.all([
    prisma.project.count(),
    prisma.project.count({ where: { status: 'READY' } }),
    prisma.vendor.count({ where: { status: 'APPROVED' } }),
    prisma.vendor.count({ where: { status: 'PENDING' } }),
    prisma.dop.count({ where: { status: 'APPROVED' } }),
    prisma.dop.count({ where: { status: 'PENDING' } }),
    countEmbeddableDops().catch(() => 0),
    prisma.projectRecommendation.findMany({
      select: { recommendedEquipmentIds: true, matchedDops: true },
      take: 500,
      orderBy: { generatedAt: 'desc' },
    }),
    prisma.agentRun.findMany({
      orderBy: { startedAt: 'desc' },
      take: 20,
      select: {
        id: true,
        agent: true,
        status: true,
        attempt: true,
        latencyMs: true,
        startedAt: true,
        model: true,
        project: { select: { id: true, name: true } },
      },
    }),
  ]);

  // Most-recommended equipment / most-matched DOPs, counted from stored sheets.
  const equipmentTally = new Map<string, number>();
  const dopTally = new Map<string, number>();
  for (const row of recommendations) {
    for (const id of row.recommendedEquipmentIds) {
      equipmentTally.set(id, (equipmentTally.get(id) ?? 0) + 1);
    }
    const dops = (row.matchedDops as unknown as Array<{ dopId?: string }>) ?? [];
    for (const dop of dops) {
      if (dop?.dopId) dopTally.set(dop.dopId, (dopTally.get(dop.dopId) ?? 0) + 1);
    }
  }

  const topEquipmentIds = [...equipmentTally.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  const topDopIds = [...dopTally.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);

  const [topEquipment, topDops] = await Promise.all([
    prisma.equipment.findMany({
      where: { id: { in: topEquipmentIds.map(([id]) => id) } },
      select: { id: true, brand: true, model: true },
    }),
    prisma.dop.findMany({
      where: { id: { in: topDopIds.map(([id]) => id) } },
      select: { id: true, displayName: true },
    }),
  ]);

  const equipmentNames = new Map(topEquipment.map((item) => [item.id, `${item.brand} ${item.model}`]));
  const dopNames = new Map(topDops.map((item) => [item.id, item.displayName]));

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-strong">{t('overview')}</h1>

      <div className="grid grid-cols-2 gap-2.5 sm:gap-3 lg:grid-cols-5">
        <Stat label={t('projects')} value={<AnimatedNumber value={projectCount} />} />
        <Stat label={t('scriptsAnalyzed')} value={<AnimatedNumber value={readyCount} />} />
        <Stat
          label={t('vendorsApproved')}
          value={<AnimatedNumber value={vendorsApproved} />}
          hint={t('pendingCount', { count: vendorsPending })}
        />
        <Stat
          label={t('dopsApproved')}
          value={<AnimatedNumber value={dopsApproved} />}
          hint={t('pendingCount', { count: dopsPending })}
        />
        <Stat
          label={t('styleVectors')}
          value={<AnimatedNumber value={embedded} />}
          hint={t('missingCount', { count: dopsApproved - embedded })}
        />
      </div>

      {(vendorsPending > 0 || dopsPending > 0) && (
        <Card title={t('pendingApprovals')}>
          <div className="flex flex-wrap gap-3">
            {vendorsPending > 0 && (
              <Link href="/admin/vendors" className="btn-secondary text-xs">
                {t('vendorsTitle')} · {vendorsPending}
              </Link>
            )}
            {dopsPending > 0 && (
              <Link href="/admin/dops" className="btn-secondary text-xs">
                {t('dopsTitle')} · {dopsPending}
              </Link>
            )}
          </div>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title={t('topEquipment')}>
          {topEquipmentIds.length === 0 ? (
            <p className="prose-sheet">—</p>
          ) : (
            <div className="table-wrap">
              <table className="grid-table grid-table-compact [--grid-cols:2.5rem_minmax(10rem,1fr)_6rem]">
                <thead>
                  <tr>
                    <th>{t('rank')}</th>
                    <th>{t('item')}</th>
                    <th className="text-end">{t('sheets')}</th>
                  </tr>
                </thead>
                <tbody>
                  {topEquipmentIds.map(([id, count], index) => (
                    <tr key={id}>
                      <td data-label={t('rank')} className="tabular-nums text-muted">{index + 1}</td>
                      <td data-label={t('item')} className="text-strong">{equipmentNames.get(id) ?? id}</td>
                      <td data-label={t('sheets')} className="text-end tabular-nums text-accent">{count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card title={t('topDops')}>
          {topDopIds.length === 0 ? (
            <p className="prose-sheet">—</p>
          ) : (
            <div className="table-wrap">
              <table className="grid-table grid-table-compact [--grid-cols:2.5rem_minmax(10rem,1fr)_6rem]">
                <thead>
                  <tr>
                    <th>{t('rank')}</th>
                    <th>{t('cinematographer')}</th>
                    <th className="text-end">{t('matches')}</th>
                  </tr>
                </thead>
                <tbody>
                  {topDopIds.map(([id, count], index) => (
                    <tr key={id}>
                      <td data-label={t('rank')} className="tabular-nums text-muted">{index + 1}</td>
                      <td data-label={t('cinematographer')} className="text-strong">{dopNames.get(id) ?? id}</td>
                      <td data-label={t('matches')} className="text-end tabular-nums text-accent">{count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      <Card title={t('recentRuns')} subtitle={t('recentRunsHint')}>
        {recentRuns.length === 0 ? (
          <p className="prose-sheet">{t('noRuns')}</p>
        ) : (
          <div className="table-wrap">
            <table className="grid-table grid-table-wide [--grid-cols:9rem_minmax(8rem,1.6fr)_6.5rem_5rem_6.5rem_7rem_7rem]">
              <thead>
                <tr>
                  <th>{t('agent')}</th>
                  <th>{t('project')}</th>
                  <th>{t('status')}</th>
                  <th className="text-end">{t('attempt')}</th>
                  <th className="text-end">{t('latency')}</th>
                  <th>{t('model')}</th>
                  <th>{t('date')}</th>
                </tr>
              </thead>
              <tbody>
                {recentRuns.map((run) => (
                  <tr key={run.id}>
                    <td data-label={t('agent')} className="text-strong">{tEnum(`agent.${run.agent}`)}</td>
                    <td data-label={t('project')} className="text-muted">{run.project.name}</td>
                    <td data-label={t('status')}>
                      <Badge tone={RUN_TONE[run.status]}>{run.status}</Badge>
                    </td>
                    <td data-label={t('attempt')} className="text-end tabular-nums">{run.attempt}</td>
                    <td data-label={t('latency')} className="text-end tabular-nums">{run.latencyMs ? `${run.latencyMs} ms` : '—'}</td>
                    <td data-label={t('model')} className="text-xs text-muted">{run.model ?? '—'}</td>
                    <td data-label={t('date')} className="text-xs text-muted/70">{formatDate(run.startedAt, locale)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

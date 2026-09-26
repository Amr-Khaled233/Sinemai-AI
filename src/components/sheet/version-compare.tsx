import { getTranslations } from 'next-intl/server';
import { Badge, Card, EmptyState } from '@/components/ui';
import { Link } from '@/i18n/routing';
import { formatDate, formatMoney } from '@/lib/utils';
import type { SheetComparison } from '@/lib/versions';

type VersionRow = {
  version: number;
  reason: string;
  generatedAt: Date;
  estimatedBudgetMid: number;
  currency: string;
  budgetTier: string;
};

const CHANGE_TONE = {
  added: 'green',
  removed: 'red',
  changed: 'amber',
  same: 'neutral',
} as const;

/** Signed money, because the sign is the whole point of a diff. */
function delta(value: number, locale: string, currency: string) {
  const formatted = formatMoney(Math.abs(value), locale, currency);
  if (value === 0) return `±${formatted}`;
  return `${value > 0 ? '+' : '−'}${formatted}`;
}

export async function VersionHistory({
  projectId,
  versions,
  locale,
}: {
  projectId: string;
  versions: VersionRow[];
  locale: string;
}) {
  const t = await getTranslations('versions');

  if (versions.length === 0) {
    return (
      <Card title={t('title')}>
        <EmptyState title={t('empty')} />
      </Card>
    );
  }

  return (
    <Card title={t('title')} subtitle={t('subtitle')}>
      <ul className="space-y-2">
        {versions.map((version) => (
          <li
            key={version.version}
            className="flex flex-wrap items-center gap-3 rounded-md border border-line bg-surface-sunken/60 p-3"
          >
            <Badge tone="gold">v{version.version}</Badge>
            <span className="text-xs text-muted">{t(`reason.${version.reason}`)}</span>
            <span className="text-xs text-muted">{formatDate(version.generatedAt, locale)}</span>
            <span className="text-sm tabular-nums text-strong">
              {formatMoney(version.estimatedBudgetMid, locale, version.currency)}
            </span>
            <Link
              href={`/producer/projects/${projectId}/compare/${version.version}`}
              className="btn-secondary ms-auto text-xs"
            >
              {t('compare')}
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export async function VersionComparison({
  comparison,
  locale,
}: {
  comparison: SheetComparison;
  locale: string;
}) {
  const [t, tSheet] = await Promise.all([getTranslations('versions'), getTranslations('sheet')]);
  const currency = comparison.right.currency;
  const changed = comparison.packageRows.filter((row) => row.change !== 'same');

  return (
    <div className="space-y-6">
      <Card
        title={t('comparing', { left: comparison.left.label, right: comparison.right.label })}
        subtitle={`${formatDate(comparison.left.generatedAt, locale)} → ${formatDate(
          comparison.right.generatedAt,
          locale,
        )}`}
      >
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 sm:gap-3">
          <div className="stat">
            <div className="stat-label">{tSheet('budgetMid')}</div>
            <div
              className={`stat-value ${
                comparison.budget.midDelta > 0
                  ? 'text-danger'
                  : comparison.budget.midDelta < 0
                    ? 'text-success'
                    : ''
              }`}
            >
              {delta(comparison.budget.midDelta, locale, currency)}
            </div>
            <div className="mt-1 text-xs text-muted">
              {formatMoney(comparison.left.mid, locale, currency)} →{' '}
              {formatMoney(comparison.right.mid, locale, currency)}
            </div>
          </div>

          <div className="stat">
            <div className="stat-label">{tSheet('equipmentRental')}</div>
            <div className="stat-value">{delta(comparison.budget.equipmentDelta, locale, currency)}</div>
          </div>

          <div className="stat">
            <div className="stat-label">{tSheet('crew')}</div>
            <div className="stat-value">{delta(comparison.budget.crewDelta, locale, currency)}</div>
          </div>

          <div className="stat">
            <div className="stat-label">{tSheet('shootDays')}</div>
            <div className="stat-value">
              {comparison.budget.shootDaysDelta > 0 ? '+' : ''}
              {comparison.budget.shootDaysDelta}
            </div>
          </div>
        </div>
      </Card>

      <Card title={t('packageChanges')} subtitle={t('changedCount', { count: changed.length })}>
        {changed.length === 0 ? (
          <p className="prose-sheet">{t('noPackageChange')}</p>
        ) : (
          <div className="table-wrap">
            <table className="grid-table [--grid-cols:7rem_minmax(11rem,2fr)_7rem_8rem_8rem]">
              <thead>
                <tr>
                  <th>{t('change')}</th>
                  <th>{tSheet('item')}</th>
                  <th>{tSheet('category')}</th>
                  <th className="text-end">{t('before')}</th>
                  <th className="text-end">{t('after')}</th>
                </tr>
              </thead>
              <tbody>
                {changed.map((row) => (
                  <tr key={row.equipmentId}>
                    <td data-label={t('change')}>
                      <Badge tone={CHANGE_TONE[row.change]}>{t(`change.${row.change}`)}</Badge>
                    </td>
                    <td data-label={tSheet('item')} className="font-medium text-strong">
                      {row.label}
                    </td>
                    <td data-label={tSheet('category')} className="text-xs uppercase text-accent">
                      {row.categorySlug}
                    </td>
                    <td data-label={t('before')} className="text-end tabular-nums text-muted">
                      {row.before ? `×${row.before.quantity} · ${row.before.rentalDays}d` : '—'}
                    </td>
                    <td data-label={t('after')} className="text-end tabular-nums text-strong">
                      {row.after ? `×${row.after.quantity} · ${row.after.rentalDays}d` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {comparison.dopsChanged && (
        <Card title={tSheet('dopsTitle')}>
          <ul className="space-y-1.5 text-sm">
            {comparison.addedDops.map((name) => (
              <li key={name} className="text-success">
                + {name}
              </li>
            ))}
            {comparison.removedDops.map((name) => (
              <li key={name} className="text-danger">
                − {name}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

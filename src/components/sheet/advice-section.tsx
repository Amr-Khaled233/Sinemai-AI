import { getTranslations } from 'next-intl/server';
import { Badge, Card } from '@/components/ui';
import { convert, type Fx } from '@/lib/currency';
import { formatMoney } from '@/lib/utils';
import { safeHttpUrls } from '@/lib/security';
import type { Advice } from '@/agents/types';

const FIT_TONE = { within: 'green', under: 'teal', over: 'red', unknown: 'neutral' } as const;
const RISK_TONE = { safety: 'red', cost: 'amber', both: 'red' } as const;

/**
 * The advisor's section of the sheet: how long the shoot takes, how the
 * estimate sits against the producer's budget, the scenes that cost or risk the
 * most with ways to handle each, several directors, actors and cinematographers
 * to approach, equipment beyond the catalog, and savings. It says plainly that
 * these are suggestions — people and market prices to confirm — unlike the
 * priced tables, which come from the platform's own data.
 */
export async function AdviceSection({ advice, locale, fx }: { advice: Advice; locale: string; fx: Fx }) {
  const t = await getTranslations('sheet');
  const money = (sar: number | null) => (sar === null ? null : formatMoney(convert(sar, fx), locale, fx.code));
  const sources = advice.sources.filter((source) => safeHttpUrls([source.url]).length > 0);

  return (
    <Card title={t('adviceTitle')} subtitle={t('adviceHint')}>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="stat">
          <div className="stat-label">{t('shootDuration')}</div>
          <div className="stat-value">
            {t('daysCount', { count: advice.shootDuration.days })}
            <span className="ms-2 text-sm font-normal text-muted">
              ({advice.shootDuration.rangeLow}–{advice.shootDuration.rangeHigh})
            </span>
          </div>
          <p className="mt-2 text-xs leading-6 text-muted" dir="auto">
            {advice.shootDuration.rationale}
          </p>
        </div>
        <div className="stat">
          <div className="flex items-center justify-between gap-2">
            <div className="stat-label">{t('budgetFit')}</div>
            <Badge tone={FIT_TONE[advice.budgetFit.verdict]}>{t(`fit.${advice.budgetFit.verdict}`)}</Badge>
          </div>
          <p className="mt-3 text-sm leading-7 text-body" dir="auto">
            {advice.budgetFit.note}
          </p>
        </div>
      </div>

      {advice.costlyScenes.length > 0 && (
        <section className="mt-6">
          <h3 className="mb-3 text-sm font-semibold text-strong">{t('costlyScenes')}</h3>
          <div className="table-wrap">
            <table className="grid-table [--grid-cols:5rem_minmax(12rem,1.3fr)_6rem_minmax(14rem,2fr)]">
              <thead>
                <tr>
                  <th>{t('scenesCol')}</th>
                  <th>{t('whyCostly')}</th>
                  <th>{t('risk')}</th>
                  <th>{t('howToSave')}</th>
                </tr>
              </thead>
              <tbody>
                {advice.costlyScenes.map((row, index) => (
                  <tr key={index}>
                    <td data-label={t('scenesCol')} className="tabular-nums text-strong">
                      {row.scenes}
                    </td>
                    <td data-label={t('whyCostly')} className="text-sm" dir="auto">
                      {row.whyCostly}
                    </td>
                    <td data-label={t('risk')}>
                      <Badge tone={RISK_TONE[row.risk]}>{t(`riskKind.${row.risk}`)}</Badge>
                    </td>
                    <td data-label={t('howToSave')}>
                      <ul className="space-y-1 text-sm text-muted">
                        {row.options.map((option) => (
                          <li key={option} className="flex gap-2" dir="auto">
                            <span className="text-accent">•</span>
                            {option}
                          </li>
                        ))}
                      </ul>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {advice.savings.length > 0 && (
        <section className="mt-6">
          <h3 className="mb-3 text-sm font-semibold text-strong">{t('savingsTitle')}</h3>
          <ul className="grid gap-2 md:grid-cols-2">
            {advice.savings.map((saving) => (
              <li key={saving.idea} className="flex items-start justify-between gap-3 rounded-md border border-line p-3 text-sm">
                <span dir="auto">{saving.idea}</span>
                {saving.estimatedSavingSar !== null && (
                  <span className="shrink-0 tabular-nums text-success">−{money(saving.estimatedSavingSar)}</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <PeopleList title={t('suggestedDirectors')} people={advice.directors} />
        <PeopleList title={t('suggestedCinematographers')} people={advice.cinematographers} />
      </div>

      {advice.cast.length > 0 && (
        <section className="mt-6">
          <h3 className="mb-3 text-sm font-semibold text-strong">{t('suggestedCast')}</h3>
          <div className="table-wrap">
            <table className="grid-table grid-table-compact [--grid-cols:minmax(9rem,0.8fr)_minmax(16rem,2fr)]">
              <thead>
                <tr>
                  <th>{t('role')}</th>
                  <th>{t('options')}</th>
                </tr>
              </thead>
              <tbody>
                {advice.cast.map((row) => (
                  <tr key={row.role}>
                    <td data-label={t('role')} className="font-medium text-strong" dir="auto">
                      {row.role}
                    </td>
                    <td data-label={t('options')}>
                      <ul className="space-y-1.5 text-sm">
                        {row.suggestions.map((person) => (
                          <li key={person.name} dir="auto">
                            <span className="font-medium text-strong">{person.name}</span>
                            <span className="text-muted"> — {person.why}</span>
                          </li>
                        ))}
                      </ul>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {advice.equipmentIdeas.length > 0 && (
        <section className="mt-6">
          <h3 className="mb-3 text-sm font-semibold text-strong">{t('beyondCatalog')}</h3>
          <div className="table-wrap">
            <table className="grid-table grid-table-compact [--grid-cols:minmax(10rem,1fr)_minmax(14rem,2fr)_8rem]">
              <thead>
                <tr>
                  <th>{t('item')}</th>
                  <th>{t('reason')}</th>
                  <th className="text-end">{t('approxRate')}</th>
                </tr>
              </thead>
              <tbody>
                {advice.equipmentIdeas.map((idea) => (
                  <tr key={idea.item}>
                    <td data-label={t('item')} className="font-medium text-strong" dir="auto">
                      {idea.item}
                    </td>
                    <td data-label={t('reason')} className="text-sm text-muted" dir="auto">
                      {idea.why}
                    </td>
                    <td data-label={t('approxRate')} className="text-end tabular-nums">
                      {idea.approxDayRateSar !== null ? `~${money(idea.approxDayRateSar)}` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <p className="alert mt-6 border-warning/40 bg-warning/10 text-warning">{t('adviceDisclaimer')}</p>

      {sources.length > 0 && (
        <details className="mt-4 text-xs text-muted">
          <summary className="cursor-pointer">{t('sources', { count: sources.length })}</summary>
          <ul className="mt-2 space-y-1">
            {sources.map((source) => (
              <li key={source.url}>
                <a href={source.url} target="_blank" rel="noreferrer noopener" className="hover:text-accent" dir="auto">
                  {source.title} ↗
                </a>
              </li>
            ))}
          </ul>
        </details>
      )}
    </Card>
  );
}

async function PeopleList({ title, people }: { title: string; people: Advice['directors'] }) {
  if (people.length === 0) return null;
  return (
    <section>
      <h3 className="mb-3 text-sm font-semibold text-strong">{title}</h3>
      <ul className="space-y-2">
        {people.map((person) => (
          <li key={person.name} className="rounded-md border border-line p-3">
            <p className="font-medium text-strong" dir="auto">
              {person.name}
            </p>
            <p className="text-xs text-accent" dir="auto">
              {person.knownFor}
            </p>
            <p className="mt-1 text-sm text-muted" dir="auto">
              {person.why}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}

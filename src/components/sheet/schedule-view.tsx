import { getTranslations } from 'next-intl/server';
import { Badge, Card, Stat } from '@/components/ui';
import { truncate } from '@/lib/utils';
import type { Schedule } from '@/lib/schedule';

const WARNING_TONE = {
  'mixed-call': 'red',
  'over-hours': 'amber',
  'company-moves': 'amber',
  special: 'teal',
} as const;

/**
 * The schedule is derived from the breakdown, not stored: it is a reading of
 * the scene data, so it stays correct when a scene's hours change.
 */
export async function ScheduleView({ schedule }: { schedule: Schedule }) {
  const [t, tEnum] = await Promise.all([getTranslations('schedule'), getTranslations('enum')]);

  if (schedule.days.length === 0) return null;

  return (
    <Card title={t('title')} subtitle={t('subtitle')}>
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 sm:gap-3">
        <Stat label={t('days')} value={schedule.days.length} />
        <Stat label={t('hours')} value={schedule.totalHours} />
        <Stat label={t('companyMoves')} value={schedule.companyMoves} />
        <Stat
          label={t('nightDays')}
          value={schedule.days.filter((day) => day.unit !== 'DAY').length}
        />
      </div>

      <ol className="mt-5 space-y-3">
        {schedule.days.map((day) => (
          <li key={day.day} className="rounded-lg border border-line bg-surface-sunken/60 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex size-8 items-center justify-center rounded-lg border border-accent/40 bg-accent/10 text-xs font-semibold text-accent">
                {day.day}
              </span>
              <h3 className="text-sm font-semibold text-strong">{t('day', { number: day.day })}</h3>
              <Badge tone={day.unit === 'DAY' ? 'gold' : 'teal'}>{tEnum(`time.${day.unit}`)}</Badge>
              <span className="text-xs text-muted">{t('dayHours', { hours: day.hours })}</span>
              {day.warnings.map((warning) => (
                <Badge key={warning.kind} tone={WARNING_TONE[warning.kind]}>
                  {t(`warning.${warning.kind}`)}
                </Badge>
              ))}
            </div>

            <p className="mt-2 text-xs text-muted">{day.locations.join(' · ')}</p>

            <ul className="mt-3 space-y-1.5">
              {day.scenes.map((scene) => (
                <li key={scene.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
                  <span className="w-6 shrink-0 tabular-nums text-muted">{scene.order}</span>
                  <span className="min-w-0 flex-1 text-body">{truncate(scene.heading, 68)}</span>
                  <span className="text-xs tabular-nums text-muted">
                    {t('dayHours', { hours: scene.estimatedHours ?? 2 })}
                  </span>
                </li>
              ))}
            </ul>

            {day.warnings
              .filter((warning) => warning.kind === 'special')
              .map((warning) => (
                <p key={warning.kind} className="mt-3 text-xs text-info">
                  {t('specialLabel')}: {warning.detail}
                </p>
              ))}
          </li>
        ))}
      </ol>

      <p className="mt-4 text-[11px] leading-5 text-muted/70">{t('note')}</p>
    </Card>
  );
}

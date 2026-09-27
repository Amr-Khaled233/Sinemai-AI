'use client';

import { useLocale, useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import type { SceneFlag } from '@/agents/types';

const SEVERITY_EDGE: Record<SceneFlag['severity'], string> = {
  high: 'border-s-danger',
  medium: 'border-s-warning',
  low: 'border-s-line-strong',
};

const SEVERITY_TEXT: Record<SceneFlag['severity'], string> = {
  high: 'text-danger',
  medium: 'text-warning',
  low: 'text-muted',
};

/**
 * The scenes the assistant flagged after reading the script: dangerous action,
 * a special camera for one moment, a very long scene, a location to find and
 * book. Shown while the analysis runs, above the questions it pauses on, and
 * at the top of the finished sheet — the producer should never find out about
 * a car chase from the budget total.
 */
export function SceneFlags({ flags, className }: { flags: SceneFlag[]; className?: string }) {
  const t = useTranslations('sheet.flags');
  const separator = useLocale() === 'ar' ? '، ' : ', ';
  if (flags.length === 0) return null;

  return (
    <section
      className={cn('animate-scale-in rounded-lg border border-warning/40 bg-warning/[0.06] p-4 sm:p-5', className)}
      aria-labelledby="scene-flags-title"
    >
      <div className="flex items-start gap-3">
        <svg
          aria-hidden
          viewBox="0 0 24 24"
          className="mt-0.5 size-5 shrink-0 text-warning"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
          <path d="M12 9v4M12 17h.01" />
        </svg>
        <div className="min-w-0">
          <h2 id="scene-flags-title" className="flex items-center gap-2 text-sm font-semibold text-strong">
            {t('title')}
            <span className="rounded-full bg-warning/15 px-2 py-0.5 text-[11px] font-medium tabular-nums text-warning">
              {flags.length}
            </span>
          </h2>
          <p className="mt-0.5 text-xs text-muted">{t('hint')}</p>
        </div>
      </div>

      <ul className="mt-4 grid gap-3 md:grid-cols-2">
        {flags.map((flag) => (
          <li
            key={flag.id}
            className={cn('rounded-md border border-line border-s-4 bg-surface p-3.5', SEVERITY_EDGE[flag.severity])}
          >
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
              <span className="rounded-full border border-line px-2 py-0.5 font-medium text-strong">
                {t(`kind.${flag.kind}`)}
              </span>
              <span className="tabular-nums text-muted">{t('scenes', { list: flag.scenes.join(separator) })}</span>
              <span className={cn('ms-auto font-medium', SEVERITY_TEXT[flag.severity])}>
                {t(`severity.${flag.severity}`)}
              </span>
            </div>
            <p className="mt-2 text-sm font-semibold text-strong" dir="auto">
              {flag.title}
            </p>
            {flag.detail && (
              <p className="mt-1 text-xs leading-6 text-muted" dir="auto">
                {flag.detail}
              </p>
            )}
            {flag.needs.length > 0 && (
              <div className="mt-2.5">
                <p className="text-[11px] font-medium text-body">{t('needs')}</p>
                <ul className="mt-1 flex flex-wrap gap-1.5">
                  {flag.needs.map((need) => (
                    <li key={need} className="rounded bg-surface-sunken px-2 py-0.5 text-[11px] text-body" dir="auto">
                      {need}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

'use client';

import { useCallback, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/routing';
import type { ProgressEvent, ProgressStage } from '@/agents/types';

const STAGE_ORDER: ProgressStage[] = [
  'queued',
  'parsing',
  'analyzing_scenes',
  'matching_equipment',
  'matching_dops',
  'pricing',
  'reviewing',
  'saving',
  'done',
];

type State = {
  running: boolean;
  stage: ProgressStage;
  pct: number;
  detail?: string;
  logs: string[];
  error: string | null;
};

const INITIAL: State = { running: false, stage: 'queued', pct: 0, logs: [], error: null };

export function AnalysisRunner({
  projectId,
  label,
  disabled,
}: {
  projectId: string;
  label: string;
  disabled?: boolean;
}) {
  const t = useTranslations('analysis');
  const router = useRouter();
  const [state, setState] = useState<State>(INITIAL);
  const abortRef = useRef<AbortController | null>(null);

  const run = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setState({ ...INITIAL, running: true });

    try {
      const response = await fetch(`/api/projects/${projectId}/analyze`, {
        method: 'POST',
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        setState((s) => ({ ...s, running: false, error: payload.error ?? 'ANALYSIS_FAILED' }));
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffered = '';

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffered += decoder.decode(value, { stream: true });

        // NDJSON: a chunk can split a line, so only complete lines are parsed.
        const lines = buffered.split('\n');
        buffered = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.trim()) continue;
          let event: ProgressEvent;
          try {
            event = JSON.parse(line) as ProgressEvent;
          } catch {
            continue;
          }

          setState((current) => {
            switch (event.type) {
              case 'stage':
                return { ...current, stage: event.stage, pct: event.pct, detail: event.detail };
              case 'scenes':
                return { ...current, logs: [...current.logs, `${event.count} scenes`] };
              case 'log':
                return { ...current, logs: [...current.logs, event.message] };
              case 'error':
                return { ...current, running: false, stage: 'error', error: event.message };
              case 'done':
                return { ...current, running: false, stage: 'done', pct: 100 };
              default:
                return current;
            }
          });

          if (event.type === 'done') {
            router.refresh();
          }
        }
      }
    } catch (error) {
      if ((error as Error).name === 'AbortError') return;
      setState((s) => ({ ...s, running: false, error: (error as Error).message }));
    }
  }, [projectId, router]);

  const currentIndex = STAGE_ORDER.indexOf(state.stage);

  return (
    <div>
      <button type="button" className="btn-primary" onClick={run} disabled={disabled || state.running}>
        {state.running ? t('stage.' + state.stage) : label}
      </button>

      {(state.running || state.stage === 'done' || state.error) && (
        <div className="mt-5 rounded-xl border border-ink-600/70 bg-ink-900/60 p-4">
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <h3 className="text-sm font-semibold text-white">{t('title')}</h3>
            <span className="text-xs tabular-nums text-[rgb(var(--muted))]">{state.pct}%</span>
          </div>

          <div className="progress-rail">
            <div className="progress-fill" style={{ width: `${Math.max(state.pct, 3)}%` }} />
          </div>

          <ol className="mt-4 space-y-1.5">
            {STAGE_ORDER.filter((s) => s !== 'done').map((stage, index) => {
              const done = currentIndex > index || state.stage === 'done';
              const active = state.stage === stage;
              return (
                <li
                  key={stage}
                  className={`flex items-center gap-2 text-xs ${
                    active ? 'text-brass-400' : done ? 'text-teal-400/80' : 'text-[rgb(var(--muted))]/60'
                  }`}
                >
                  <span
                    className={`inline-block size-1.5 rounded-full ${
                      active ? 'animate-pulse bg-brass-400' : done ? 'bg-teal-400/70' : 'bg-ink-600'
                    }`}
                  />
                  {t(`stage.${stage}`)}
                  {active && state.detail ? ` · ${state.detail}` : ''}
                </li>
              );
            })}
          </ol>

          {state.logs.length > 0 && (
            <p className="mt-3 text-[11px] text-[rgb(var(--muted))]/70">{state.logs.join(' · ')}</p>
          )}

          <p className="mt-3 text-[11px] text-[rgb(var(--muted))]/60">{t('agents')}</p>

          {state.error && (
            <div className="mt-3">
              <p className="text-xs text-red-400">{t('failed', { message: state.error })}</p>
              <button type="button" className="btn-secondary mt-3 text-xs" onClick={run}>
                {t('retry')}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

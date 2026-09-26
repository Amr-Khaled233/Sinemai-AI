'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/routing';
import { CheckIcon, Spinner } from '@/components/ui';
import { cn } from '@/lib/utils';
import type { ClarifyQuestion, ProgressEvent, ProgressStage } from '@/agents/types';

const STAGE_ORDER: ProgressStage[] = [
  'queued',
  'parsing',
  'analyzing_scenes',
  'clarifying',
  'matching_equipment',
  'matching_dops',
  'pricing',
  'reviewing',
  'saving',
  'done',
];

/**
 * Safety net only. The analysis normally finishes in a handful of round trips;
 * this cap stops a pathological loop from hammering the endpoint forever.
 */
const MAX_REQUESTS = 40;

type State = {
  running: boolean;
  stage: ProgressStage;
  pct: number;
  detail?: string;
  logs: string[];
  error: string | null;
  requests: number;
  /** Another tab or device is advancing this run; we watch instead of driving. */
  watching: boolean;
  /** The run is paused until the producer answers these. */
  questions: ClarifyQuestion[];
};

const INITIAL: State = {
  running: false,
  stage: 'queued',
  pct: 0,
  logs: [],
  error: null,
  requests: 0,
  watching: false,
  questions: [],
};

/** How often to re-check a run that another client is driving. */
const WATCH_INTERVAL_MS = 3000;

export function AnalysisRunner({
  projectId,
  label,
  disabled,
  /** True when the server already has a run in flight for this project. */
  inFlight = false,
}: {
  projectId: string;
  label: string;
  disabled?: boolean;
  inFlight?: boolean;
}) {
  const t = useTranslations('analysis');
  const locale = useLocale();
  const router = useRouter();
  const [state, setState] = useState<State>(INITIAL);
  const abortRef = useRef<AbortController | null>(null);

  /** Runs one slice of the graph; returns true when the whole run is finished. */
  const runSlice = useCallback(
    async (
      start: boolean,
      signal: AbortSignal,
      answers?: Record<string, string>,
    ): Promise<boolean> => {
      const response = await fetch(`/api/projects/${projectId}/analyze`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        // The run answers in whatever language the producer is reading right now.
        body: JSON.stringify({ start, locale, answers }),
        signal,
      });

      if (!response.ok || !response.body) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        setState((s) => ({ ...s, running: false, error: payload.error ?? 'ANALYSIS_FAILED' }));
        return true;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffered = '';
      let finished = false;
      let busy = false;

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
              case 'questions':
                return { ...current, questions: event.questions };
              case 'log':
                return { ...current, logs: [...current.logs, event.message] };
              case 'error':
                return { ...current, running: false, stage: 'error', error: event.message };
              case 'done':
                return { ...current, stage: 'done', pct: 100 };
              case 'checkpoint':
                return { ...current, pct: Math.max(current.pct, event.pct) };
              default:
                return current;
            }
          });

          if (event.type === 'checkpoint') {
            // A pause is a stopping point too: nothing moves until the producer answers.
            finished = event.done || event.failed || Boolean(event.awaiting);
            if (event.busy) {
              // Someone else holds the lease. Stop driving and watch instead,
              // so the same step is never executed — and billed — twice.
              busy = true;
              finished = true;
            }
          }
          if (event.type === 'error') finished = true;
        }
      }

      if (busy) setState((current) => ({ ...current, watching: true }));
      return finished;
    },
    [projectId, locale],
  );

  const drive = useCallback(
    async (start: boolean, answers?: Record<string, string>) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setState({ ...INITIAL, running: true });

      try {
        // Each request executes as many steps as fit in its budget, then hands
        // back a resume point — so no single function call has to be long.
        for (let request = 0; request < MAX_REQUESTS; request += 1) {
          setState((s) => ({ ...s, requests: request + 1 }));
          const first = request === 0;
          const finished = await runSlice(start && first, controller.signal, first ? answers : undefined);
          if (finished) break;
        }

        setState((s) => {
          if (s.error || s.watching) return { ...s, running: s.watching };
          if (s.stage === 'awaiting_input') return { ...s, running: false };
          return { ...s, running: false, stage: 'done', pct: 100 };
        });
        router.refresh();
      } catch (error) {
        if ((error as Error).name === 'AbortError') return;
        setState((s) => ({ ...s, running: false, error: (error as Error).message }));
      }
    },
    [router, runSlice],
  );

  /** Starts a fresh analysis. */
  const run = useCallback(() => drive(true), [drive]);

  /** Releases a paused run; blank answers mean "go with the assumption". */
  const answer = useCallback((answers: Record<string, string>) => drive(false, answers), [drive]);

  const awaiting = state.stage === 'awaiting_input' && state.questions.length > 0 && !state.running;

  /**
   * The run continues on the server whether or not this page is open, so a
   * producer who closed the tab or reloaded mid-run should rejoin it rather
   * than see an idle button and start a second one.
   */
  useEffect(() => {
    if (!inFlight) return;
    let cancelled = false;

    (async () => {
      const response = await fetch(`/api/projects/${projectId}/analyze`);
      if (!response.ok || cancelled) return;
      const status = (await response.json()) as {
        running?: boolean;
        driven?: boolean;
        awaiting?: boolean;
        questions?: ClarifyQuestion[];
      };
      if (cancelled || !status.running) return;

      // Paused on questions: show them, and spend no request until they are answered.
      if (status.awaiting) {
        setState({ ...INITIAL, stage: 'awaiting_input', pct: 48, questions: status.questions ?? [] });
        return;
      }

      // Another client is already advancing it: watch. Otherwise pick it up.
      if (status.driven) setState((s) => ({ ...s, running: true, watching: true }));
      else void drive(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [inFlight, projectId, drive]);

  /**
   * While another client drives, poll the checkpoint. If that client goes away
   * its lease expires and this one takes over, so a run is never orphaned.
   */
  useEffect(() => {
    if (!state.watching) return;
    let cancelled = false;

    const timer = setInterval(async () => {
      const response = await fetch(`/api/projects/${projectId}/analyze`);
      if (!response.ok || cancelled) return;
      const status = (await response.json()) as {
        running?: boolean;
        driven?: boolean;
        stage?: string;
        sceneCursor?: number;
        sceneTotal?: number;
        errorText?: string | null;
        awaiting?: boolean;
        questions?: ClarifyQuestion[];
      };
      if (cancelled) return;

      if (status.awaiting) {
        setState({ ...INITIAL, stage: 'awaiting_input', pct: 48, questions: status.questions ?? [] });
        return;
      }

      if (!status.running) {
        setState((s) => ({
          ...s,
          running: false,
          watching: false,
          stage: status.errorText ? 'error' : 'done',
          pct: 100,
          error: status.errorText ?? null,
        }));
        router.refresh();
        return;
      }

      if (status.sceneTotal) {
        setState((s) => ({ ...s, detail: `${status.sceneCursor}/${status.sceneTotal}` }));
      }
      // The other driver stopped without finishing: take the run over.
      if (!status.driven) {
        setState((s) => ({ ...s, watching: false }));
        void drive(false);
      }
    }, WATCH_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [state.watching, projectId, router, drive]);

  // A pause sits on the clarifying step of the list.
  const currentIndex = STAGE_ORDER.indexOf(state.stage === 'awaiting_input' ? 'clarifying' : state.stage);

  return (
    <div>
      <button
        type="button"
        className="btn-primary w-full sm:w-auto"
        onClick={run}
        disabled={disabled || state.running || awaiting}
      >
        {state.running ? (
          <>
            <Spinner />
            {t(`stage.${state.stage}`)}
          </>
        ) : (
          <>
            <svg
              aria-hidden
              viewBox="0 0 24 24"
              className="size-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M5 3v18l15-9z" />
            </svg>
            {label}
          </>
        )}
      </button>

      {awaiting && <ClarifyForm questions={state.questions} onSubmit={answer} />}

      {(state.running || state.stage === 'done' || state.error) && (
        <div className="mt-5 animate-scale-in rounded-2xl border border-line bg-surface-sunken/70 p-4">
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <h3 className="text-sm font-semibold text-strong">{t('title')}</h3>
            <span className="text-xs font-medium tabular-nums text-accent">{state.pct}%</span>
          </div>

          <div className="progress-rail">
            <div className="progress-fill" style={{ width: `${Math.max(state.pct, 3)}%` }} />
          </div>

          <ol className="mt-4 space-y-2">
            {STAGE_ORDER.filter((s) => s !== 'done').map((stage, index) => {
              const done = currentIndex > index || state.stage === 'done';
              const active = state.stage === stage;
              return (
                <li
                  key={stage}
                  className={cn(
                    'flex items-center gap-2.5 text-xs transition-colors duration-300 ease-smooth',
                    active && 'text-accent',
                    done && 'text-success',
                    !active && !done && 'text-muted/[0.55]',
                  )}
                >
                  <span className="relative grid size-4 shrink-0 place-items-center">
                    {done ? (
                      <CheckIcon className="size-3.5" />
                    ) : active ? (
                      <>
                        <span className="absolute inline-flex size-3 animate-pulse-ring rounded-full bg-accent/60" />
                        <span className="relative size-1.5 rounded-full bg-accent" />
                      </>
                    ) : (
                      <span className="size-1.5 rounded-full bg-line-strong" />
                    )}
                  </span>
                  <span className={cn(active && 'font-medium')}>
                    {t(`stage.${active && state.stage === 'awaiting_input' ? 'awaiting_input' : stage}`)}
                  </span>
                  {active && state.detail && (
                    <span className="animate-fade-in text-muted">· {state.detail}</span>
                  )}
                </li>
              );
            })}
          </ol>

          {state.logs.length > 0 && (
            <p className="mt-3 animate-fade-in border-t border-line/60 pt-3 text-[11px] text-muted/70">
              {state.logs.join(' · ')}
            </p>
          )}

          <p className="mt-3 text-[11px] text-muted/60">{t('agents')}</p>

          {state.error && (
            <div className="mt-3">
              <p className="text-xs text-red-500">{t('failed', { message: state.error })}</p>
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

/**
 * The questions a paused run is waiting on. Every field may be left blank: the
 * run then goes with the assumption shown under it, so answering is never a
 * gate the producer cannot get past.
 */
function ClarifyForm({
  questions,
  onSubmit,
}: {
  questions: ClarifyQuestion[];
  onSubmit: (answers: Record<string, string>) => void;
}) {
  const t = useTranslations('analysis.clarify');
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const set = (id: string, value: string) => setAnswers((current) => ({ ...current, [id]: value }));

  return (
    <form
      className="mt-5 animate-scale-in rounded-2xl border border-accent/40 bg-surface-sunken/70 p-4"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(answers);
      }}
    >
      <h3 className="text-sm font-semibold text-strong">{t('title')}</h3>
      <p className="mt-1 text-xs text-muted">{t('intro')}</p>

      <ol className="mt-4 space-y-5">
        {questions.map((q, index) => (
          <li key={q.id}>
            <label htmlFor={`clarify-${q.id}`} className="text-sm font-medium text-strong">
              {index + 1}. {q.question}
            </label>
            {q.why && <p className="mt-0.5 text-[11px] text-muted">{q.why}</p>}

            {q.options.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {q.options.map((option) => (
                  <button
                    key={option}
                    type="button"
                    className={cn('chip text-[11px]', answers[q.id] === option && 'chip-on')}
                    aria-pressed={answers[q.id] === option}
                    onClick={() => set(q.id, answers[q.id] === option ? '' : option)}
                  >
                    {option}
                  </button>
                ))}
              </div>
            )}

            <input
              id={`clarify-${q.id}`}
              className="input mt-2 w-full text-sm"
              value={answers[q.id] ?? ''}
              maxLength={500}
              onChange={(event) => set(q.id, event.target.value)}
              placeholder={t('placeholder')}
            />
            <p className="mt-1 text-[11px] text-muted/70">{t('assumption', { assumption: q.assumption })}</p>
          </li>
        ))}
      </ol>

      <div className="mt-5 flex flex-wrap gap-2">
        <button type="submit" className="btn-primary text-xs">
          {t('submit')}
        </button>
        <button type="button" className="btn-secondary text-xs" onClick={() => onSubmit({})}>
          {t('skip')}
        </button>
      </div>
    </form>
  );
}

'use client';

import { useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/routing';
import { startFromScript } from '@/app/actions/projects';
import { Spinner } from '@/components/ui';
import { StyleTagPicker, type StyleTag } from '@/components/style-tag-picker';
import { cn } from '@/lib/utils';

const ACCEPT = '.fountain,.fdx,.pdf,.txt,.md,application/pdf,text/plain,text/xml,application/xml';

type Option = { value: string; label: string; hint?: string };

/**
 * The one place a user starts: drop or paste a script, say what kind of
 * production and roughly what budget, and go. The analysis starts on the next
 * page and whatever else matters is asked in the conversation.
 */
export function StartFromScript({
  types,
  tiers,
  styleTags,
  defaultCity,
}: {
  types: Option[];
  tiers: Option[];
  /** The visual style vocabulary; it steers the equipment and the cinematographer match. */
  styleTags: StyleTag[];
  defaultCity: string;
}) {
  const t = useTranslations('project');
  const locale = useLocale();
  const [style, setStyle] = useState<string[]>([]);
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<'file' | 'paste'>('file');
  const [fileName, setFileName] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [type, setType] = useState(types[0]?.value ?? '');
  const [tier, setTier] = useState(tiers[1]?.value ?? tiers[0]?.value ?? '');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pick = (files: FileList | null) => {
    if (!files?.length || !fileRef.current) return;
    const transfer = new DataTransfer();
    transfer.items.add(files[0]);
    fileRef.current.files = transfer.files;
    setFileName(files[0].name);
    setError(null);
  };

  return (
    <form
      className="card p-5 sm:p-8"
      action={async (formData) => {
        setPending(true);
        setError(null);
        formData.set('type', type);
        formData.set('budgetTier', tier);
        const result = await startFromScript(formData);
        if (result.ok && result.projectId) {
          router.push(`/producer/projects/${result.projectId}?start=1`);
          return;
        }
        setPending(false);
        const code = result.ok ? '' : result.error;
        setError(['NO_SCRIPT', 'EMPTY_SCRIPT', 'NO_SCENES_FOUND'].includes(code) ? t('noScript') : t('startFailed'));
      }}
    >
      <p className="eyebrow">{t('startKicker')}</p>
      <h1 className="mt-3 text-2xl font-semibold uppercase text-strong sm:text-3xl rtl:normal-case">{t('startTitle')}</h1>
      <p className="mt-2 max-w-2xl text-sm leading-7 text-muted">{t('startBody')}</p>

      <div className="mt-6 flex gap-2" role="tablist">
        {(['file', 'paste'] as const).map((value) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={mode === value}
            onClick={() => setMode(value)}
            className={cn('chip', mode === value && 'chip-on')}
          >
            {value === 'file' ? t('uploadFile') : t('pasteInstead')}
          </button>
        ))}
      </div>

      <div className="mt-4">
        {/* The file input stays mounted so a picked file survives switching tabs. */}
        <input
          ref={fileRef}
          type="file"
          name="file"
          accept={ACCEPT}
          className="sr-only"
          tabIndex={-1}
          onChange={(event) => pick(event.target.files)}
        />
        {mode === 'file' ? (
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              pick(event.dataTransfer.files);
            }}
            className={cn(
              'flex w-full flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-6 py-12 text-center transition-colors',
              dragging ? 'border-accent-soft bg-accent-soft/10' : 'border-line-strong hover:border-accent-soft',
            )}
          >
            <svg aria-hidden viewBox="0 0 24 24" className="size-8 text-accent" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
              <path d="M14 3v5h5M12 18v-6M9 15l3-3 3 3" />
            </svg>
            <span className="text-sm font-medium text-strong" dir="auto">
              {fileName ?? t('dropHere')}
            </span>
            <span className="text-xs text-muted">{t('uploadHint')}</span>
          </button>
        ) : (
          <textarea
            name="pasted"
            rows={10}
            dir="auto"
            className="input min-h-[14rem] resize-y leading-7"
            placeholder={t('pastePlaceholder')}
            aria-label={t('pasteInstead')}
          />
        )}
      </div>

      <div className="mt-6 grid gap-5 lg:grid-cols-[1fr_1fr_14rem]">
        <fieldset>
          <legend className="label">{t('type')}</legend>
          <div className="flex flex-wrap gap-2">
            {types.map((option) => (
              <button
                key={option.value}
                type="button"
                aria-pressed={type === option.value}
                onClick={() => setType(option.value)}
                className={cn('chip', type === option.value && 'chip-on')}
              >
                {option.label}
              </button>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend className="label">{t('budgetTier')}</legend>
          <div className="flex flex-wrap gap-2">
            {tiers.map((option) => (
              <button
                key={option.value}
                type="button"
                aria-pressed={tier === option.value}
                title={option.hint}
                onClick={() => setTier(option.value)}
                className={cn('chip', tier === option.value && 'chip-on')}
              >
                {option.label}
              </button>
            ))}
          </div>
          {tiers.find((option) => option.value === tier)?.hint && (
            <p className="mt-2 text-[11px] text-muted">{tiers.find((option) => option.value === tier)?.hint}</p>
          )}
        </fieldset>
        <div>
          <label className="label" htmlFor="start-city">
            {t('city')}
          </label>
          <input id="start-city" name="city" className="input" dir="auto" placeholder={defaultCity} />
        </div>
      </div>

      {styleTags.length > 0 && (
        <fieldset className="mt-6">
          <legend className="label">{t('visualStyle')}</legend>
          <StyleTagPicker tags={styleTags} locale={locale} selected={style} onChange={setStyle} />
          <p className="mt-2 text-[11px] text-muted">{t('visualStyleHint')}</p>
        </fieldset>
      )}

      {error && <p className="alert-danger mt-5">{error}</p>}

      <button type="submit" className="btn-primary mt-6 w-full px-8 py-3 sm:w-auto" disabled={pending}>
        {pending && <Spinner />}
        {pending ? t('starting') : t('startButton')}
      </button>
    </form>
  );
}

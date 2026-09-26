'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/routing';
import { resetSiteCopy, saveSiteCopy } from '@/app/actions/admin';
import { checkOverride, type CopyProblem } from '@/lib/site-copy';
import { Badge, Select, Spinner } from '@/components/ui';
import { cn } from '@/lib/utils';

export type CopyRow = {
  key: string;
  /** Shipped text, which a reset returns to. */
  original: { en: string; ar: string };
  /** What the site shows now (the override if there is one). */
  current: { en: string; ar: string };
  edited: boolean;
};

/**
 * Every string the site shows, editable in both languages. Edits are checked
 * here as you type and again on the server, so a message that would break its
 * page cannot be saved.
 */
export function ContentEditor({ rows, namespaces }: { rows: CopyRow[]; namespaces: string[] }) {
  const t = useTranslations('admin');
  const [namespace, setNamespace] = useState(namespaces.includes('landing') ? 'landing' : namespaces[0]);
  const [query, setQuery] = useState('');

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return rows.filter((row) => {
      // A search looks across every section; otherwise show one section.
      if (needle) {
        return [row.key, row.current.en, row.current.ar].some((text) => text.toLowerCase().includes(needle));
      }
      return row.key.startsWith(`${namespace}.`);
    });
  }, [rows, namespace, query]);

  const editedCount = rows.filter((row) => row.edited).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-56">
          <label className="label" htmlFor="copy-section">
            {t('contentSection')}
          </label>
          <Select
            id="copy-section"
            value={namespace}
            disabled={Boolean(query.trim())}
            onChange={(event) => setNamespace(event.target.value)}
          >
            {namespaces.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </Select>
        </div>
        <div className="min-w-[14rem] flex-1">
          <label className="label" htmlFor="copy-search">
            {t('contentSearch')}
          </label>
          <input
            id="copy-search"
            className="input"
            dir="auto"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <p className="pb-3 text-xs text-muted">{t('contentEditedCount', { count: editedCount })}</p>
      </div>

      <div className="table-wrap">
        <table className="grid-table grid-table-wide [--grid-cols:minmax(9rem,0.8fr)_minmax(14rem,1.6fr)_minmax(14rem,1.6fr)_8.5rem]">
          <thead>
            <tr>
              <th>{t('contentKey')}</th>
              <th>English</th>
              <th>العربية</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => (
              <CopyRowEditor key={row.key} row={row} />
            ))}
          </tbody>
        </table>
      </div>
      {visible.length === 0 && <p className="prose-sheet">{t('contentNoMatch')}</p>}
    </div>
  );
}

function CopyRowEditor({ row }: { row: CopyRow }) {
  const t = useTranslations('admin');
  const router = useRouter();
  const [en, setEn] = useState(row.current.en);
  const [ar, setAr] = useState(row.current.ar);
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  const dirty = en !== row.current.en || ar !== row.current.ar;
  const problems = {
    en: en === row.original.en ? null : checkOverride(row.original.en, en),
    ar: ar === row.original.ar ? null : checkOverride(row.original.ar, ar),
  };
  const blocked = Boolean(problems.en || problems.ar);

  const describe = (problem: CopyProblem | null) => {
    if (!problem) return null;
    if (problem === 'EMPTY') return t('copyEmpty');
    if (problem === 'TOO_LONG') return t('copyTooLong');
    if (problem === 'SYNTAX') return t('copySyntax');
    return t('copyUnknownVariables', { names: problem.unknownVariables.map((name) => `{${name}}`).join(', ') });
  };

  async function run(action: () => Promise<{ ok: boolean }>) {
    setStatus('saving');
    const result = await action();
    setStatus(result.ok ? 'saved' : 'error');
    if (result.ok) router.refresh();
  }

  const field = (value: string, onChange: (next: string) => void, locale: 'en' | 'ar') => {
    const problem = describe(problems[locale]);
    return (
      <>
        <textarea
          className={cn('input min-h-[4.5rem] resize-y text-sm leading-6', problem && 'border-danger')}
          dir={locale === 'ar' ? 'rtl' : 'ltr'}
          lang={locale}
          aria-label={`${row.key} (${locale})`}
          value={value}
          onChange={(event) => {
            onChange(event.target.value);
            setStatus('idle');
          }}
        />
        {problem && <span className="mt-1 block text-[11px] text-danger">{problem}</span>}
      </>
    );
  };

  return (
    <tr>
      <td data-label={t('contentKey')}>
        <code className="break-all text-xs text-muted" dir="ltr">
          {row.key}
        </code>
        {row.edited && (
          <span className="mt-1.5 block">
            <Badge tone="gold">{t('contentEdited')}</Badge>
          </span>
        )}
      </td>
      <td data-label="English">{field(en, setEn, 'en')}</td>
      <td data-label="العربية">{field(ar, setAr, 'ar')}</td>
      <td>
        <span className="flex flex-wrap gap-2 lg:flex-col lg:items-stretch">
          <button
            type="button"
            className="btn-primary px-4 text-xs"
            disabled={!dirty || blocked || status === 'saving'}
            onClick={() => run(() => saveSiteCopy(row.key, { en, ar }))}
          >
            {status === 'saving' && <Spinner />}
            {t('save')}
          </button>
          {row.edited && (
            <button
              type="button"
              className="btn-ghost px-3 text-xs"
              disabled={status === 'saving'}
              onClick={() => run(() => resetSiteCopy(row.key))}
            >
              {t('contentReset')}
            </button>
          )}
          {status === 'saved' && <span className="text-[11px] text-success">{t('saved')}</span>}
          {status === 'error' && <span className="text-[11px] text-danger">{t('saveFailed')}</span>}
        </span>
      </td>
    </tr>
  );
}

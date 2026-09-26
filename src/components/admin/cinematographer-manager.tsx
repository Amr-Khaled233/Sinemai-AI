'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/routing';
import { deleteCinematographer, saveCinematographer, setCinematographerActive } from '@/app/actions/admin';
import { Badge, Field, Input, Spinner, Textarea } from '@/components/ui';
import { StyleTagPicker } from '@/components/style-tag-picker';

type StyleTag = { slug: string; labelEn: string; labelAr: string };

export type CinematographerRow = {
  id: string;
  displayName: string;
  displayNameAr: string | null;
  bio: string;
  city: string | null;
  dayRate: number | null;
  yearsExperience: number | null;
  portfolioLinks: string[];
  styleTags: string[];
  active: boolean;
  /** Whether it has a style vector, i.e. can be matched. */
  matchable: boolean;
};

/** Cinematographer profiles: add, edit, switch off, delete. */
export function CinematographerManager({
  rows,
  tags,
  locale,
}: {
  rows: CinematographerRow[];
  tags: StyleTag[];
  locale: string;
}) {
  const t = useTranslations('admin');
  const td = useTranslations('dop');
  const tc = useTranslations('common');
  const router = useRouter();
  const [editing, setEditing] = useState<CinematographerRow | 'new' | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState(false);

  const open = (row: CinematographerRow | 'new') => {
    setEditing(row);
    setSelected(row === 'new' ? [] : row.styleTags);
    setError(false);
  };

  async function run(key: string, action: () => Promise<{ ok: boolean }>) {
    setPending(key);
    setError(false);
    const result = await action();
    setPending(null);
    if (!result.ok) setError(true);
    else {
      setEditing(null);
      router.refresh();
    }
  }

  const current = editing === 'new' ? null : editing;

  return (
    <div className="space-y-5">
      {editing === null ? (
        <button type="button" className="btn-primary text-xs" onClick={() => open('new')}>
          {t('addCinematographer')}
        </button>
      ) : (
        <form
          key={current?.id ?? 'new'}
          className="rounded-md border border-accent-soft/50 bg-surface-sunken p-4"
          action={(formData) => run('form', () => saveCinematographer(formData))}
        >
          {current && <input type="hidden" name="id" value={current.id} />}
          <div className="grid gap-x-4 sm:grid-cols-2">
            <Field label={td('displayName')}>
              <Input name="displayName" required defaultValue={current?.displayName ?? ''} />
            </Field>
            <Field label={td('displayNameAr')}>
              <Input name="displayNameAr" dir="rtl" defaultValue={current?.displayNameAr ?? ''} />
            </Field>
          </div>
          <Field label={td('bio')} hint={td('bioHint')}>
            <Textarea name="bio" required minLength={40} rows={5} defaultValue={current?.bio ?? ''} />
          </Field>
          <div className="grid gap-x-4 sm:grid-cols-3">
            <Field label={td('city')}>
              <Input name="city" defaultValue={current?.city ?? ''} />
            </Field>
            <Field label={td('dayRate')}>
              <Input name="dayRate" type="number" min={0} dir="ltr" defaultValue={current?.dayRate ?? ''} />
            </Field>
            <Field label={td('years')}>
              <Input
                name="yearsExperience"
                type="number"
                min={0}
                max={70}
                dir="ltr"
                defaultValue={current?.yearsExperience ?? ''}
              />
            </Field>
          </div>
          <Field label={td('portfolio')} hint={td('portfolioHint')}>
            <Textarea
              name="portfolioLinks"
              rows={3}
              dir="ltr"
              defaultValue={current?.portfolioLinks.join('\n') ?? ''}
              placeholder={'https://vimeo.com/…\nhttps://www.imdb.com/name/…'}
            />
          </Field>
          <Field label={td('styleTags')}>
            <StyleTagPicker tags={tags} locale={locale} selected={selected} onChange={setSelected} name="styleTags" />
          </Field>
          {error && <p className="alert-danger mb-3">{t('saveFailed')}</p>}
          <div className="flex gap-2">
            <button type="submit" className="btn-primary text-xs" disabled={pending === 'form' || selected.length === 0}>
              {pending === 'form' && <Spinner />}
              {t('save')}
            </button>
            <button type="button" className="btn-ghost text-xs" onClick={() => setEditing(null)}>
              {tc('cancel')}
            </button>
          </div>
        </form>
      )}

      {rows.length === 0 ? (
        <p className="prose-sheet">{t('noCinematographers')}</p>
      ) : (
        <div className="table-wrap">
          <table className="grid-table grid-table-wide [--grid-cols:minmax(11rem,1.3fr)_minmax(7rem,0.8fr)_6.5rem_minmax(12rem,1.6fr)_7.5rem_minmax(11rem,auto)]">
            <thead>
              <tr>
                <th>{t('cinematographer')}</th>
                <th>{td('city')}</th>
                <th className="text-end">{td('dayRate')}</th>
                <th>{td('styleTags')}</th>
                <th>{t('status')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td data-label={t('cinematographer')}>
                    <span className="block font-medium text-strong">
                      {locale === 'ar' && row.displayNameAr ? row.displayNameAr : row.displayName}
                    </span>
                    {row.yearsExperience !== null && (
                      <span className="text-xs text-muted">{td('yearsShort', { count: row.yearsExperience })}</span>
                    )}
                  </td>
                  <td data-label={td('city')}>{row.city ?? '—'}</td>
                  <td data-label={td('dayRate')} className="text-end tabular-nums">
                    {row.dayRate ?? '—'}
                  </td>
                  <td data-label={td('styleTags')}>
                    <span className="flex flex-wrap gap-1">
                      {row.styleTags.map((tag) => (
                        <span key={tag} className="chip text-[11px]">
                          {tags.find((option) => option.slug === tag)?.[locale === 'ar' ? 'labelAr' : 'labelEn'] ?? tag}
                        </span>
                      ))}
                    </span>
                  </td>
                  <td data-label={t('status')}>
                    <span className="flex flex-wrap gap-1.5">
                      <Badge tone={row.active ? 'green' : 'neutral'}>{row.active ? t('active') : t('hidden')}</Badge>
                      {!row.matchable && <Badge tone="amber">{t('notMatchable')}</Badge>}
                    </span>
                  </td>
                  <td>
                    <span className="flex flex-wrap gap-1.5 lg:justify-end">
                      <button type="button" className="btn-ghost px-2.5 text-xs" onClick={() => open(row)}>
                        {tc('edit')}
                      </button>
                      <button
                        type="button"
                        className="btn-ghost px-2.5 text-xs"
                        disabled={pending === row.id}
                        onClick={() => run(row.id, () => setCinematographerActive(row.id, !row.active))}
                      >
                        {row.active ? t('hide') : t('show')}
                      </button>
                      <button
                        type="button"
                        className="btn-ghost px-2.5 text-xs text-danger"
                        disabled={pending === row.id}
                        onClick={() => {
                          if (window.confirm(t('confirmDeleteCinematographer', { name: row.displayName }))) {
                            void run(row.id, () => deleteCinematographer(row.id));
                          }
                        }}
                      >
                        {t('delete')}
                      </button>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

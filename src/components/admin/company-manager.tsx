'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/routing';
import { deleteRentalCompany, saveRentalCompany, setRentalCompanyActive } from '@/app/actions/admin';
import { Badge, Field, Input, Spinner } from '@/components/ui';

export type CompanyRow = {
  id: string;
  name: string;
  city: string;
  phone: string | null;
  email: string | null;
  website: string | null;
  crNumber: string | null;
  items: number;
  active: boolean;
};

/** Rental companies: add, edit, switch off, delete. Their stock lives on the Rentals page. */
export function CompanyManager({ rows }: { rows: CompanyRow[] }) {
  const t = useTranslations('admin');
  const tc = useTranslations('common');
  const router = useRouter();
  const [editing, setEditing] = useState<CompanyRow | 'new' | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState(false);

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
        <button type="button" className="btn-primary text-xs" onClick={() => setEditing('new')}>
          {t('addCompany')}
        </button>
      ) : (
        <form
          key={current?.id ?? 'new'}
          className="rounded-md border border-accent-soft/50 bg-surface-sunken p-4"
          action={(formData) => run('form', () => saveRentalCompany(formData))}
        >
          {current && <input type="hidden" name="id" value={current.id} />}
          <div className="grid gap-x-4 sm:grid-cols-2">
            <Field label={t('companyName')}>
              <Input name="name" required defaultValue={current?.name ?? ''} />
            </Field>
            <Field label={t('city')}>
              <Input name="city" required defaultValue={current?.city ?? ''} />
            </Field>
            <Field label={t('phone')}>
              <Input name="phone" type="tel" dir="ltr" defaultValue={current?.phone ?? ''} />
            </Field>
            <Field label={t('email')}>
              <Input name="email" type="email" dir="ltr" defaultValue={current?.email ?? ''} />
            </Field>
            <Field label={t('website')}>
              <Input name="website" type="url" dir="ltr" placeholder="https://" defaultValue={current?.website ?? ''} />
            </Field>
            <Field label={t('crNumber')}>
              <Input name="crNumber" dir="ltr" inputMode="numeric" defaultValue={current?.crNumber ?? ''} />
            </Field>
          </div>
          {error && <p className="alert-danger mb-3">{t('saveFailed')}</p>}
          <div className="flex gap-2">
            <button type="submit" className="btn-primary text-xs" disabled={pending === 'form'}>
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
        <p className="prose-sheet">{t('noCompanies')}</p>
      ) : (
        <div className="table-wrap">
          <table className="grid-table grid-table-wide [--grid-cols:minmax(11rem,1.4fr)_minmax(8rem,1fr)_minmax(11rem,1.2fr)_5rem_6.5rem_minmax(13rem,auto)]">
            <thead>
              <tr>
                <th>{t('companyName')}</th>
                <th>{t('city')}</th>
                <th>{t('contact')}</th>
                <th className="text-end">{t('items')}</th>
                <th>{t('status')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td data-label={t('companyName')} className="font-medium text-strong">
                    {row.name}
                  </td>
                  <td data-label={t('city')}>{row.city}</td>
                  <td data-label={t('contact')} className="text-xs text-muted" dir="ltr">
                    {[row.phone, row.email].filter(Boolean).join(' · ') || '—'}
                  </td>
                  <td data-label={t('items')} className="text-end tabular-nums">
                    {row.items}
                  </td>
                  <td data-label={t('status')}>
                    <Badge tone={row.active ? 'green' : 'neutral'}>{row.active ? t('active') : t('hidden')}</Badge>
                  </td>
                  <td>
                    <span className="flex flex-wrap gap-1.5 lg:justify-end">
                      <Link href={`/admin/rentals?vendor=${row.id}`} className="btn-ghost px-2.5 text-xs">
                        {t('rentalsTitle')}
                      </Link>
                      <button type="button" className="btn-ghost px-2.5 text-xs" onClick={() => setEditing(row)}>
                        {tc('edit')}
                      </button>
                      <button
                        type="button"
                        className="btn-ghost px-2.5 text-xs"
                        disabled={pending === row.id}
                        onClick={() => run(row.id, () => setRentalCompanyActive(row.id, !row.active))}
                      >
                        {row.active ? t('hide') : t('show')}
                      </button>
                      <button
                        type="button"
                        className="btn-ghost px-2.5 text-xs text-danger"
                        disabled={pending === row.id}
                        onClick={() => {
                          if (window.confirm(t('confirmDeleteCompany', { name: row.name }))) {
                            void run(row.id, () => deleteRentalCompany(row.id));
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

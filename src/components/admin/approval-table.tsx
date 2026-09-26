'use client';

import { Fragment, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/routing';
import { setDopStatus, setVendorStatus, toggleVendorVerified } from '@/app/actions/admin';
import { Badge } from '@/components/ui';
import { safeHttpUrls } from '@/lib/security';

export type ApprovalRow = {
  id: string;
  title: string;
  subtitle: string;
  detail: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  verified?: boolean;
  links?: string[];
  tags?: string[];
  meta?: string;
};

export function ApprovalTable({ kind, rows }: { kind: 'VENDOR' | 'DOP'; rows: ApprovalRow[] }) {
  const t = useTranslations('admin');
  const tEnum = useTranslations('enum');
  const tc = useTranslations('common');
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [reasonFor, setReasonFor] = useState<string | null>(null);
  const [reason, setReason] = useState('');

  async function act(id: string, status: 'APPROVED' | 'REJECTED', why?: string) {
    setPendingId(id);
    if (kind === 'VENDOR') await setVendorStatus(id, status, why);
    else await setDopStatus(id, status, why);
    setPendingId(null);
    setReasonFor(null);
    setReason('');
    router.refresh();
  }

  if (rows.length === 0) return <p className="prose-sheet">—</p>;

  return (
    <div className="table-wrap">
      <table className="grid-table grid-table-wide [--grid-cols:minmax(11rem,1.2fr)_7rem_minmax(14rem,2fr)_minmax(8rem,1fr)_minmax(11rem,auto)]">
        <thead>
          <tr>
            <th>{t('applicant')}</th>
            <th>{t('status')}</th>
            <th>{t('details')}</th>
            <th>{t('links')}</th>
            <th className="text-end">{t('actions')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <Fragment key={row.id}>
              <tr>
                <td data-label={t('applicant')}>
                  <span className="block font-medium text-strong">{row.title}</span>
                  <span className="mt-0.5 block text-xs text-muted">{row.subtitle}</span>
                  {row.meta && <span className="mt-1 block text-[11px] text-muted/70">{row.meta}</span>}
                </td>
                <td data-label={t('status')}>
                  <span className="flex flex-wrap gap-1.5">
                    <Badge tone={row.status === 'APPROVED' ? 'green' : row.status === 'REJECTED' ? 'red' : 'amber'}>
                      {tEnum(`approval.${row.status}`)}
                    </Badge>
                    {row.verified && <Badge tone="teal">{t('verified')}</Badge>}
                  </span>
                </td>
                <td data-label={t('details')}>
                  {row.detail ? (
                    <span dir="auto" className="block text-sm leading-6 text-muted">
                      {row.detail}
                    </span>
                  ) : (
                    <span className="text-muted">—</span>
                  )}
                  {row.tags && row.tags.length > 0 && (
                    <span className="mt-2 flex flex-wrap gap-1.5">
                      {row.tags.map((tag) => (
                        <span key={tag} className="chip text-[11px]">
                          {tag}
                        </span>
                      ))}
                    </span>
                  )}
                </td>
                <td data-label={t('links')}>
                  {row.links && row.links.length > 0 ? (
                    <span className="flex flex-col gap-1 text-xs">
                      {safeHttpUrls(row.links).map((link) => (
                        <a
                          key={link}
                          href={link}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="tap-link truncate text-info hover:underline"
                          dir="ltr"
                        >
                          {link.replace(/^https?:\/\//, '').slice(0, 40)} ↗
                        </a>
                      ))}
                    </span>
                  ) : (
                    <span className="text-muted">—</span>
                  )}
                </td>
                <td>
                  <span className="flex flex-wrap items-center gap-2 lg:justify-end">
                    {row.status !== 'APPROVED' && (
                      <button
                        type="button"
                        className="btn-primary px-4 text-xs"
                        disabled={pendingId === row.id}
                        onClick={() => act(row.id, 'APPROVED')}
                      >
                        {t('approve')}
                      </button>
                    )}
                    {row.status !== 'REJECTED' && (
                      <button
                        type="button"
                        className="btn-danger px-4 text-xs"
                        disabled={pendingId === row.id}
                        onClick={() => setReasonFor(reasonFor === row.id ? null : row.id)}
                      >
                        {t('reject')}
                      </button>
                    )}
                    {kind === 'VENDOR' && row.status === 'APPROVED' && (
                      <button
                        type="button"
                        className="btn-ghost text-xs"
                        disabled={pendingId === row.id}
                        onClick={async () => {
                          setPendingId(row.id);
                          await toggleVendorVerified(row.id, !row.verified);
                          setPendingId(null);
                          router.refresh();
                        }}
                      >
                        {row.verified ? t('unverify') : t('verify')}
                      </button>
                    )}
                  </span>
                </td>
              </tr>

              {/* The rejection note spans the whole row, under the applicant it is about. */}
              {reasonFor === row.id && (
                <tr>
                  <td className="[grid-column:1/-1]">
                    <span className="flex flex-wrap items-center gap-2">
                      <input
                        className="input max-w-md"
                        placeholder={t('rejectReason')}
                        aria-label={t('rejectReason')}
                        value={reason}
                        onChange={(event) => setReason(event.target.value)}
                      />
                      <button type="button" className="btn-danger text-xs" onClick={() => act(row.id, 'REJECTED', reason)}>
                        {t('reject')}
                      </button>
                      <button type="button" className="btn-ghost text-xs" onClick={() => setReasonFor(null)}>
                        {tc('cancel')}
                      </button>
                    </span>
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

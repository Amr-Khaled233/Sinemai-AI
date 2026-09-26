'use client';

import { useState } from 'react';
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
    <ul className="space-y-3">
      {rows.map((row) => (
        <li key={row.id} className="rounded-md border border-line bg-surface-sunken p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="flex items-center gap-2 text-sm font-semibold text-strong">
                {row.title}
                <Badge tone={row.status === 'APPROVED' ? 'green' : row.status === 'REJECTED' ? 'red' : 'amber'}>
                  {tEnum(`approval.${row.status}`)}
                </Badge>
                {row.verified && <Badge tone="teal">{t('verified')}</Badge>}
              </h3>
              <p className="mt-1 text-xs text-muted">{row.subtitle}</p>
              {row.detail && (
                <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">{row.detail}</p>
              )}

              {row.tags && row.tags.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {row.tags.map((tag) => (
                    <span key={tag} className="chip text-[11px]">
                      {tag}
                    </span>
                  ))}
                </div>
              )}

              {row.links && row.links.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-3 text-xs">
                  {safeHttpUrls(row.links).map((link) => (
                    <a
                      key={link}
                      href={link}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="tap-link text-info hover:underline"
                      dir="ltr"
                    >
                      {link.replace(/^https?:\/\//, '').slice(0, 48)} ↗
                    </a>
                  ))}
                </div>
              )}

              {row.meta && <p className="mt-2 text-[11px] text-muted/70">{row.meta}</p>}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {row.status !== 'APPROVED' && (
                <button
                  type="button"
                  className="btn-primary text-xs"
                  disabled={pendingId === row.id}
                  onClick={() => act(row.id, 'APPROVED')}
                >
                  {t('approve')}
                </button>
              )}
              {row.status !== 'REJECTED' && (
                <button
                  type="button"
                  className="btn-danger text-xs"
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
            </div>
          </div>

          {reasonFor === row.id && (
            <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-line pt-3">
              <input
                className="input max-w-md"
                placeholder="Reviewer note sent to the applicant"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
              <button type="button" className="btn-danger text-xs" onClick={() => act(row.id, 'REJECTED', reason)}>
                {t('reject')}
              </button>
              <button type="button" className="btn-ghost text-xs" onClick={() => setReasonFor(null)}>
                {tc('cancel')}
              </button>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

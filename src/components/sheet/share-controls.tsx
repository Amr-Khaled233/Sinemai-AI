'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { createShareLink, revokeShareLinks } from '@/app/actions/projects';

export function ShareControls({
  projectId,
  locale,
  existingToken,
}: {
  projectId: string;
  locale: string;
  existingToken: string | null;
}) {
  const t = useTranslations('sheet');
  const [token, setToken] = useState(existingToken);
  const [copied, setCopied] = useState(false);
  const [pending, setPending] = useState(false);

  const shareUrl = token ? `${typeof window === 'undefined' ? '' : window.location.origin}/${locale}/share/${token}` : null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <a href={`/api/projects/${projectId}/pdf?locale=${locale}`} className="btn-secondary text-xs" target="_blank" rel="noreferrer">
        {t('exportPdf')}
      </a>

      {shareUrl ? (
        <>
          <button
            type="button"
            className="btn-secondary text-xs"
            onClick={async () => {
              await navigator.clipboard.writeText(shareUrl);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            }}
          >
            {copied ? t('shareCopied') : shareUrl.replace(/^https?:\/\//, '').slice(0, 42)}
          </button>
          <button
            type="button"
            className="btn-ghost text-xs"
            disabled={pending}
            onClick={async () => {
              setPending(true);
              await revokeShareLinks(projectId);
              setToken(null);
              setPending(false);
            }}
          >
            {t('shareRevoke')}
          </button>
        </>
      ) : (
        <button
          type="button"
          className="btn-secondary text-xs"
          disabled={pending}
          onClick={async () => {
            setPending(true);
            const result = await createShareLink(projectId);
            if (result.ok && result.token) setToken(result.token);
            setPending(false);
          }}
        >
          {t('share')}
        </button>
      )}
    </div>
  );
}

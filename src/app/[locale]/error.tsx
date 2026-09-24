'use client';

import { useEffect } from 'react';
import { useTranslations } from 'next-intl';

/**
 * Page-level error boundary. The digest is Next's own id for the server error,
 * which matches the reference in the logs — so a user quoting it maps straight
 * to one log line.
 */
export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations('common');

  useEffect(() => {
    // Client-side failures never reach the server hook, so they are logged here.
    console.error(
      JSON.stringify({ level: 'error', event: 'client.error', message: error.message, digest: error.digest }),
    );
  }, [error]);

  return (
    <div className="mx-auto max-w-lg animate-fade-up py-12 text-center">
      <h1 className="text-xl font-semibold text-strong">{t('errorTitle')}</h1>
      <p className="mt-3 text-sm leading-7 text-muted">{t('errorBody')}</p>

      {error.digest && (
        <p className="mt-4 text-xs text-muted/70">
          {t('errorReference')}: <code className="font-mono text-accent">{error.digest}</code>
        </p>
      )}

      <button type="button" className="btn-primary mt-7" onClick={reset}>
        {t('retry')}
      </button>
    </div>
  );
}

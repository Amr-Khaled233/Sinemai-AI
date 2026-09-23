'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/routing';

export function ReembedButton() {
  const t = useTranslations('admin');
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  return (
    <div className="flex items-center gap-3">
      {result && <span className="text-xs text-info">{result}</span>}
      <button
        type="button"
        className="btn-secondary text-xs"
        disabled={pending}
        onClick={async () => {
          setPending(true);
          setResult(null);
          const response = await fetch('/api/cron/reembed-dops', { method: 'POST' });
          const data = (await response.json().catch(() => ({}))) as { processed?: number; error?: string };
          setPending(false);
          setResult(data.error ? data.error : t('reembedDone', { count: data.processed ?? 0 }));
          router.refresh();
        }}
      >
        {t('reembed')}
      </button>
    </div>
  );
}

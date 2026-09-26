'use client';

import { useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/routing';
import { CURRENCY_COOKIE } from '@/lib/currency';

/**
 * Picks the currency amounts are shown in. The choice lives in a cookie so the
 * server renders the right figures on the first paint, with no flash of SAR.
 */
export function CurrencySwitcher({ current, options }: { current: string; options: string[] }) {
  const t = useTranslations('nav');
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  // Nothing to choose between: say nothing rather than show a one-item menu.
  if (options.length < 2) return null;

  return (
    <label className="relative inline-flex items-center">
      <span className="sr-only">{t('currency')}</span>
      <select
        className="h-9 cursor-pointer appearance-none rounded-full border border-line bg-transparent ps-3 pe-7 font-display text-xs font-medium uppercase tracking-wider text-muted transition-colors hover:border-accent-soft hover:text-accent focus:outline-none disabled:opacity-50"
        value={current}
        disabled={pending}
        title={t('currency')}
        onChange={(event) => {
          const code = event.target.value;
          document.cookie = `${CURRENCY_COOKIE}=${code}; path=/; max-age=31536000; samesite=lax`;
          startTransition(() => router.refresh());
        }}
      >
        {options.map((code) => (
          <option key={code} value={code}>
            {code}
          </option>
        ))}
      </select>
      <svg
        aria-hidden
        viewBox="0 0 20 20"
        className="pointer-events-none absolute end-2.5 size-3 text-muted"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      >
        <path d="M6 8l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </label>
  );
}

'use client';

import { useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { usePathname, useRouter } from '@/i18n/routing';

export function LocaleSwitcher({ locale }: { locale: string }) {
  const t = useTranslations('nav');
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const next = locale === 'ar' ? 'en' : 'ar';

  return (
    <button
      type="button"
      className="btn-ghost text-xs"
      disabled={pending}
      onClick={() => startTransition(() => router.replace(pathname, { locale: next }))}
    >
      {t('language')}
    </button>
  );
}

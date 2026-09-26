import { getRequestConfig } from 'next-intl/server';
import { applyOverrides, type Messages } from '@/lib/site-copy';
import { getCopyOverrides } from '@/lib/site-copy-server';
import { routing, type AppLocale } from './config';

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = (routing.locales as readonly string[]).includes(requested ?? '')
    ? (requested as AppLocale)
    : routing.defaultLocale;

  // The shipped messages, with whatever the admin has edited on top.
  const [base, overrides] = await Promise.all([
    import(`../../messages/${locale}.json`).then((module) => module.default as Messages),
    getCopyOverrides(),
  ]);

  return {
    locale,
    messages: applyOverrides(base, overrides[locale]),
    timeZone: 'Asia/Riyadh',
    now: new Date(),
  };
});

import { defineRouting } from 'next-intl/routing';

/**
 * The locale setup on its own, with no navigation helpers attached.
 *
 * The middleware runs as an Edge Function capped at 1 MB on the Hobby plan.
 * Importing routing.ts from it pulled in next-intl's server navigation, which
 * reaches the request config, the site-copy overrides and so Prisma — and the
 * bundle went over the cap. Anything that only needs the locale list imports
 * this file instead.
 */

export const locales = ['ar', 'en'] as const;
export type AppLocale = (typeof locales)[number];

export const routing = defineRouting({
  locales,
  // English first: a visitor lands in English and switches to Arabic from the
  // header. The browser's language is not used to guess, so the site always
  // opens the same way.
  defaultLocale: 'en',
  localePrefix: 'always',
  localeDetection: false,
});

export function isRtl(locale: string) {
  return locale === 'ar';
}

export function dirFor(locale: string) {
  return isRtl(locale) ? 'rtl' : 'ltr';
}

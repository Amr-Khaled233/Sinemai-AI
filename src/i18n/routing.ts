import { defineRouting } from 'next-intl/routing';
import { createNavigation } from 'next-intl/navigation';

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

export const { Link, redirect, usePathname, useRouter, getPathname } = createNavigation(routing);

export function isRtl(locale: string) {
  return locale === 'ar';
}

export function dirFor(locale: string) {
  return isRtl(locale) ? 'rtl' : 'ltr';
}

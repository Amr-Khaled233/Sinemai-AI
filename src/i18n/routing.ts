import { defineRouting } from 'next-intl/routing';
import { createNavigation } from 'next-intl/navigation';

export const locales = ['ar', 'en'] as const;
export type AppLocale = (typeof locales)[number];

export const routing = defineRouting({
  locales,
  defaultLocale: 'ar',
  localePrefix: 'always',
});

export const { Link, redirect, usePathname, useRouter, getPathname } = createNavigation(routing);

export function isRtl(locale: string) {
  return locale === 'ar';
}

export function dirFor(locale: string) {
  return isRtl(locale) ? 'rtl' : 'ltr';
}

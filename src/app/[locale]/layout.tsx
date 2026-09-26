import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { Cairo, IBM_Plex_Sans_Arabic, Oswald } from 'next/font/google';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { ShellMessages } from '@/i18n/message-scope';
import { locales, dirFor, type AppLocale } from '@/i18n/routing';
import { Providers } from '@/components/providers';
import { TopBar } from '@/components/top-bar';
import { THEME_INIT_SCRIPT } from '@/components/theme-toggle';
import '../globals.css';

// Oswald sets headings and buttons in Latin; it has no Arabic, so Arabic in the
// same element falls through to Cairo. Body text is IBM Plex Sans Arabic, which
// carries Latin too and matches the PDF export.
// No size-adjusted Arial fallback: Arial has Arabic glyphs, so it would catch
// Arabic text before Cairo does and render it shrunk.
const display = Oswald({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-oswald',
  adjustFontFallback: false,
});
const displayArabic = Cairo({ subsets: ['arabic'], weight: ['500', '600', '700'], variable: '--font-cairo' });
const body = IBM_Plex_Sans_Arabic({
  subsets: ['arabic', 'latin'],
  weight: ['300', '400', '500', '600'],
  variable: '--font-plex',
});

export const metadata: Metadata = {
  title: 'Sinemai AI — Production & Equipment Sheets',
  description:
    'Upload a screenplay or ad brief and get a scene breakdown, an equipment package, matched cinematographers and rental vendors, and a costed budget.',
};

export function generateStaticParams() {
  return locales.map((locale) => ({ locale }));
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!(locales as readonly string[]).includes(locale)) notFound();

  setRequestLocale(locale as AppLocale);
  const t = await getTranslations({ locale, namespace: 'common' });

  return (
    <html
      lang={locale}
      dir={dirFor(locale)}
      // The theme script sets data-theme before hydration.
      suppressHydrationWarning
      data-theme="dark"
      className={`${display.variable} ${displayArabic.variable} ${body.variable}`}
    >
      <head>
        {/* Applies the stored theme before first paint, so there is no flash. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-dvh">
        <ShellMessages locale={locale}>
          <Providers>
            <TopBar locale={locale} />
            <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:py-10">{children}</main>
            <footer className="border-t border-line">
              <div className="mx-auto flex max-w-7xl flex-col gap-2 px-4 py-8 text-xs text-muted sm:flex-row sm:items-center sm:justify-between sm:px-6">
                <span>{t('tagline')}</span>
                <span dir="ltr">© {new Date().getFullYear()} Sinemai AI</span>
              </div>
            </footer>
          </Providers>
        </ShellMessages>
      </body>
    </html>
  );
}

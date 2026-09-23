import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages, setRequestLocale } from 'next-intl/server';
import { locales, dirFor, type AppLocale } from '@/i18n/routing';
import { Providers } from '@/components/providers';
import { TopBar } from '@/components/top-bar';
import { THEME_INIT_SCRIPT } from '@/components/theme-toggle';
import '../globals.css';

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
  const messages = await getMessages();

  return (
    <html lang={locale} dir={dirFor(locale)} suppressHydrationWarning>
      <head>
        {/* Applies the stored theme before first paint, so there is no flash. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-dvh">
        <NextIntlClientProvider messages={messages}>
          <Providers>
            <TopBar locale={locale} />
            <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:py-10">{children}</main>
            <footer className="mx-auto mt-10 max-w-7xl border-t border-line/60 px-4 pb-10 pt-6 text-xs text-muted/70 sm:px-6">
              Sinemai AI · سينمائي — production intelligence for film &amp; advertising.
            </footer>
          </Providers>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}

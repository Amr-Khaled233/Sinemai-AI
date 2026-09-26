import type { ReactNode } from 'react';
import { setRequestLocale } from 'next-intl/server';
import { MessageScope } from '@/i18n/message-scope';
import type { AppLocale } from '@/i18n/routing';

export default async function DopLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale as AppLocale);
  return (
    <MessageScope scope="dop" locale={locale}>
      {children}
    </MessageScope>
  );
}

import type { ReactNode } from 'react';
import { setRequestLocale } from 'next-intl/server';
import { MessageScope } from '@/i18n/message-scope';
import type { AppLocale } from '@/i18n/routing';

/**
 * A route group, so the four credential screens share one message scope without
 * changing their URLs.
 */
export default async function AuthLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale as AppLocale);
  return (
    <MessageScope scope="auth" locale={locale}>
      {children}
    </MessageScope>
  );
}

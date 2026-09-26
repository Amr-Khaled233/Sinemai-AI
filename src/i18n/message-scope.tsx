import type { ReactNode } from 'react';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages } from 'next-intl/server';
import { SCOPES, SHELL_SCOPE, pickMessages, type ScopeName } from './scopes';

/**
 * Sends one area's messages to the browser.
 *
 * A nested provider replaces the messages of the one above it rather than
 * merging with it, which is exactly what is wanted here: the shell keeps its
 * three namespaces for the top bar, and each area ships its own.
 *
 * The locale is passed in, never inferred. Layouts render in parallel, so an
 * area layout cannot rely on the locale layout having called setRequestLocale
 * first — when it had not, a statically rendered English page shipped Arabic
 * messages to its client components and the form came out half in each.
 */
export async function MessageScope({
  scope,
  locale,
  children,
}: {
  scope: ScopeName;
  locale: string;
  children: ReactNode;
}) {
  const messages = await getMessages({ locale });
  return (
    <NextIntlClientProvider locale={locale} messages={pickMessages(messages, SCOPES[scope])}>
      {children}
    </NextIntlClientProvider>
  );
}

/** The shell's own scope, used once by the locale layout. */
export async function ShellMessages({ locale, children }: { locale: string; children: ReactNode }) {
  const messages = await getMessages({ locale });
  return (
    <NextIntlClientProvider locale={locale} messages={pickMessages(messages, SHELL_SCOPE)}>
      {children}
    </NextIntlClientProvider>
  );
}

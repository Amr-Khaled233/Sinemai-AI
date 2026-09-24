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
 */
export async function MessageScope({ scope, children }: { scope: ScopeName; children: ReactNode }) {
  const messages = await getMessages();
  return (
    <NextIntlClientProvider messages={pickMessages(messages, SCOPES[scope])}>
      {children}
    </NextIntlClientProvider>
  );
}

/** The shell's own scope, used once by the locale layout. */
export async function ShellMessages({ children }: { children: ReactNode }) {
  const messages = await getMessages();
  return (
    <NextIntlClientProvider messages={pickMessages(messages, SHELL_SCOPE)}>
      {children}
    </NextIntlClientProvider>
  );
}

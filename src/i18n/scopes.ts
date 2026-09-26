import type { AbstractIntlMessages } from 'next-intl';

/**
 * Which message namespaces each part of the app needs **in the browser**.
 *
 * Server components translate through `getTranslations`, which never leaves the
 * server, so only namespaces used by a client component have to be serialised
 * into the page. Handing the whole catalog to every visitor cost ~23 KB per
 * page and meant an anonymous reader of the landing page could read the admin
 * and vendor strings straight out of the HTML.
 *
 * Adding a `useTranslations('x')` to a client component means adding `x` to the
 * scope that renders it. A namespace missing here surfaces immediately as
 * next-intl's MISSING_MESSAGE error rather than as a silent fallback.
 */

/** Present on every page: the top bar, the theme toggle and the error boundary. */
export const SHELL_SCOPE = ['nav', 'theme', 'common'] as const;

export const SCOPES = {
  /** Sign in, register, forgot and reset password. */
  auth: ['auth', 'common'],
  /** The user area: project form, upload, analysis runner, sheet editing. */
  producer: ['project', 'analysis', 'sheet', 'enum', 'common'],
  /** Admin: catalog, rental companies and their stock, cinematographers, content, settings. */
  admin: ['admin', 'vendor', 'dop', 'enum', 'common'],
  /** A shared read-only sheet: export controls. */
  share: ['sheet', 'common'],
} as const satisfies Record<string, readonly string[]>;

export type ScopeName = keyof typeof SCOPES;

/** Copies out the named namespaces, skipping any the catalog does not have. */
export function pickMessages(
  all: AbstractIntlMessages,
  namespaces: readonly string[],
): AbstractIntlMessages {
  const picked: Record<string, AbstractIntlMessages[string]> = {};
  for (const namespace of namespaces) {
    const messages = all[namespace];
    if (messages !== undefined) picked[namespace] = messages;
  }
  return picked;
}

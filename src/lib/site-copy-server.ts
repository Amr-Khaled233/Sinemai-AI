import 'server-only';
import { unstable_cache } from 'next/cache';
import { prisma } from '@/lib/prisma';
import type { CopyOverrides } from '@/lib/site-copy';

const SETTINGS_KEY = 'site-copy';
export const SITE_COPY_TAG = 'site-copy';

/**
 * The admin's copy edits. Cached across requests and dropped by tag when the
 * admin saves, so every page does not pay a database read for its strings.
 */
export const getCopyOverrides = unstable_cache(
  async (): Promise<CopyOverrides> => {
    const row = await prisma.setting.findUnique({ where: { key: SETTINGS_KEY } }).catch(() => null);
    return (row?.value as CopyOverrides | undefined) ?? {};
  },
  [SETTINGS_KEY],
  { tags: [SITE_COPY_TAG] },
);

/** Sets (or, with null, removes) one key's override in one locale. */
export async function writeCopyOverride(locale: string, key: string, text: string | null) {
  const row = await prisma.setting.findUnique({ where: { key: SETTINGS_KEY } });
  const current = ((row?.value as CopyOverrides | undefined) ?? {}) as CopyOverrides;
  const forLocale = { ...(current[locale] ?? {}) };
  if (text === null) delete forLocale[key];
  else forLocale[key] = text;
  const value = { ...current, [locale]: forLocale };

  await prisma.setting.upsert({
    where: { key: SETTINGS_KEY },
    create: { key: SETTINGS_KEY, value },
    update: { value },
  });
}

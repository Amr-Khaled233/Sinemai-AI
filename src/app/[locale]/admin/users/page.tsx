import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { Prisma } from '@prisma/client';
import { requireRole } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { Badge, Card } from '@/components/ui';
import { formatDate } from '@/lib/utils';
import type { AppLocale } from '@/i18n/routing';

const PAGE_SIZE = 100;

/**
 * Every account on the site, newest first, searchable by email or phone.
 * Phone numbers are stored however people typed them, so the search compares
 * digits without the country or trunk prefix: "+966 50 123 4567" and
 * "0501234567" are the same number.
 */
export default async function AdminUsersPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ q?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale as AppLocale);
  await requireRole('ADMIN', locale);

  const [t, { q = '' }] = await Promise.all([getTranslations('admin'), searchParams]);
  const query = q.trim().slice(0, 120);
  // Saudi numbers are written +966 5x…, 00966 5x… or 05x…; compare the part after the prefix.
  const digits = query.replace(/\D/g, '').replace(/^(00966|966|0)/, '');

  // Phones compared on digits in the database, so punctuation never hides a match.
  const phoneMatches =
    digits.length >= 4
      ? await prisma.$queryRaw<Array<{ id: string }>>`
          SELECT "id" FROM "User"
          WHERE regexp_replace(coalesce("phone", ''), '[^0-9]', '', 'g') LIKE ${'%' + digits + '%'}
          LIMIT 500`
      : [];

  const where: Prisma.UserWhereInput = query
    ? {
        OR: [
          { email: { contains: query, mode: 'insensitive' } },
          { name: { contains: query, mode: 'insensitive' } },
          { id: { in: phoneMatches.map((row) => row.id) } },
        ],
      }
    : {};

  const [total, users] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: PAGE_SIZE,
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        role: true,
        createdAt: true,
        _count: { select: { projects: true } },
      },
    }),
  ]);

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-strong">{t('usersTitle')}</h1>

      <Card subtitle={t('usersHint')}>
        <form method="get" className="flex flex-wrap items-end gap-3">
          <div className="min-w-[16rem] flex-1">
            <label className="label" htmlFor="users-q">
              {t('usersSearch')}
            </label>
            <input id="users-q" name="q" className="input" dir="auto" defaultValue={query} autoComplete="off" />
          </div>
          <button type="submit" className="btn-primary text-xs">
            {t('usersSearchButton')}
          </button>
          {query && (
            <a href="?" className="btn-ghost text-xs">
              {t('usersClear')}
            </a>
          )}
        </form>

        <p className="mt-4 text-xs text-muted">
          {query
            ? t('usersFound', { count: total })
            : t('usersTotal', { count: total, shown: Math.min(total, PAGE_SIZE) })}
        </p>

        {users.length > 0 && (
          <div className="table-wrap mt-3">
            <table className="grid-table [--grid-cols:minmax(9rem,1fr)_minmax(13rem,1.4fr)_minmax(9rem,0.9fr)_5.5rem_6rem_7.5rem]">
              <thead>
                <tr>
                  <th>{t('userName')}</th>
                  <th>{t('email')}</th>
                  <th>{t('phone')}</th>
                  <th>{t('role')}</th>
                  <th className="text-end">{t('projects')}</th>
                  <th>{t('joined')}</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr key={user.id}>
                    <td data-label={t('userName')} className="font-medium text-strong" dir="auto">
                      {user.name}
                    </td>
                    <td data-label={t('email')} dir="ltr" className="break-all">
                      <a href={`mailto:${user.email}`} className="hover:text-accent">
                        {user.email}
                      </a>
                    </td>
                    <td data-label={t('phone')} dir="ltr">
                      {user.phone ? (
                        <a href={`tel:${user.phone.replace(/[^+\d]/g, '')}`} className="hover:text-accent">
                          {user.phone}
                        </a>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                    <td data-label={t('role')}>
                      <Badge tone={user.role === 'ADMIN' ? 'gold' : 'neutral'}>
                        {user.role === 'ADMIN' ? t('roleAdmin') : t('roleUser')}
                      </Badge>
                    </td>
                    <td data-label={t('projects')} className="text-end tabular-nums">
                      {user._count.projects}
                    </td>
                    <td data-label={t('joined')} className="text-xs text-muted">
                      {formatDate(user.createdAt, locale)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/routing';
import { Badge, Card, EmptyState } from '@/components/ui';
import { CloseThreadButton, ReplyForm } from '@/components/support/support-forms';
import { ARABIC_FORMAT_LOCALE, cn, formatDate } from '@/lib/utils';
import type { listThreads, openThread } from '@/lib/support';

type ThreadRow = Awaited<ReturnType<typeof listThreads>>[number];
type OpenThread = NonNullable<Awaited<ReturnType<typeof openThread>>>;

function when(date: Date, locale: string) {
  return new Intl.DateTimeFormat(locale === 'ar' ? ARABIC_FORMAT_LOCALE : 'en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

/** The inbox: the user's own threads, or every thread for the admin. */
export async function ThreadList({
  threads,
  basePath,
  locale,
  showUser,
}: {
  threads: ThreadRow[];
  basePath: string;
  locale: string;
  showUser: boolean;
}) {
  const t = await getTranslations('support');
  if (threads.length === 0) return <EmptyState title={t('empty')} />;

  return (
    <div className="table-wrap">
      <table
        className={cn(
          'grid-table',
          showUser
            ? '[--grid-cols:minmax(12rem,1.6fr)_minmax(12rem,1.2fr)_6rem_7.5rem_9rem]'
            : 'grid-table-compact [--grid-cols:minmax(12rem,1.8fr)_6rem_7.5rem_9rem]',
        )}
      >
        <thead>
          <tr>
            <th>{t('subject')}</th>
            {showUser && <th>{t('from')}</th>}
            <th className="text-end">{t('messages')}</th>
            <th>{t('status')}</th>
            <th>{t('lastActivity')}</th>
          </tr>
        </thead>
        <tbody>
          {threads.map((thread) => (
            <tr key={thread.id}>
              <td data-label={t('subject')}>
                <Link
                  href={`${basePath}/${thread.id}`}
                  className={cn('hover:text-accent', thread.unread ? 'font-semibold text-strong' : 'text-body')}
                  dir="auto"
                >
                  {thread.subject}
                </Link>
              </td>
              {showUser && (
                <td data-label={t('from')} className="text-xs">
                  <span className="block text-body" dir="auto">
                    {thread.user.name}
                  </span>
                  <span className="text-muted" dir="ltr">
                    {[thread.user.email, thread.user.phone].filter(Boolean).join(' · ')}
                  </span>
                </td>
              )}
              <td data-label={t('messages')} className="text-end tabular-nums">
                {thread._count.messages}
              </td>
              <td data-label={t('status')}>
                {thread.unread ? (
                  <Badge tone="gold">{t('new')}</Badge>
                ) : thread.closedAt ? (
                  <Badge>{t('closed')}</Badge>
                ) : (
                  <Badge tone="green">{t('open')}</Badge>
                )}
              </td>
              <td data-label={t('lastActivity')} className="text-xs text-muted">
                {formatDate(thread.lastMessageAt, locale)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** One conversation: the messages as bubbles, then the reply box. */
export async function ThreadView({
  thread,
  viewerIsAdmin,
  backHref,
  locale,
}: {
  thread: OpenThread;
  viewerIsAdmin: boolean;
  backHref: string;
  locale: string;
}) {
  const t = await getTranslations('support');
  const closed = Boolean(thread.closedAt);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link href={backHref} className="tap-link text-xs text-muted hover:text-accent">
            ← {t('allConversations')}
          </Link>
          <h1 className="mt-2 text-xl font-semibold text-strong" dir="auto">
            {thread.subject}
          </h1>
          {viewerIsAdmin && (
            <p className="mt-1 text-xs text-muted">
              <span dir="auto">{thread.user.name}</span> ·{' '}
              <a href={`mailto:${thread.user.email}`} className="hover:text-accent" dir="ltr">
                {thread.user.email}
              </a>
              {thread.user.phone && (
                <>
                  {' · '}
                  <a href={`tel:${thread.user.phone.replace(/[^+\d]/g, '')}`} className="hover:text-accent" dir="ltr">
                    {thread.user.phone}
                  </a>
                </>
              )}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {closed && <Badge>{t('closed')}</Badge>}
          <CloseThreadButton threadId={thread.id} closed={closed} />
        </div>
      </div>

      <Card>
        <ol className="space-y-4">
          {thread.messages.map((message) => {
            // "Mine" is whichever side is reading: the admin's messages for the admin, the user's for the user.
            const mine = message.fromAdmin === viewerIsAdmin;
            return (
              <li key={message.id} className={cn('flex', mine ? 'justify-end' : 'justify-start')}>
                <div
                  className={cn(
                    'max-w-[85%] rounded-lg border px-4 py-3 sm:max-w-[70%]',
                    mine ? 'border-accent-soft/40 bg-accent-soft/10' : 'border-line bg-surface-sunken',
                  )}
                >
                  <p className="mb-1 text-[11px] text-muted">
                    {message.fromAdmin ? t('teamName') : message.sender.name} · {when(message.createdAt, locale)}
                  </p>
                  <p className="whitespace-pre-wrap text-sm leading-7 text-body" dir="auto">
                    {message.body}
                  </p>
                </div>
              </li>
            );
          })}
        </ol>

        <div className="mt-6 border-t border-line pt-5">
          <ReplyForm threadId={thread.id} />
        </div>
      </Card>
    </div>
  );
}

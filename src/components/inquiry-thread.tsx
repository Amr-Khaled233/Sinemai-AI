'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/routing';
import { markInquiryRead, replyToInquiry, setInquiryClosed } from '@/app/actions/inquiries';
import { Badge, Spinner, Textarea } from '@/components/ui';
import { cn, formatDate } from '@/lib/utils';

export type ThreadMessage = {
  id: string;
  body: string;
  createdAt: string;
  senderName: string;
  /** True when the signed-in user wrote it. */
  mine: boolean;
};

export type Thread = {
  id: string;
  subject: string;
  status: 'SENT' | 'READ' | 'REPLIED' | 'CLOSED';
  counterpartName: string;
  projectName: string | null;
  contactEmail: string;
  contactPhone: string | null;
  createdAt: string;
  closed: boolean;
  messages: ThreadMessage[];
};

const STATUS_TONE = {
  SENT: 'neutral',
  READ: 'teal',
  REPLIED: 'green',
  CLOSED: 'neutral',
} as const;

export function InquiryThread({
  thread,
  locale,
  /** Recipients mark a thread read on open; senders do not. */
  markReadOnOpen = false,
}: {
  thread: Thread;
  locale: string;
  markReadOnOpen?: boolean;
}) {
  const t = useTranslations('inquiry');
  const tEnum = useTranslations('enum');
  const tc = useTranslations('common');
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Opening a thread is what tells the producer their message was seen.
  useEffect(() => {
    if (!open || !markReadOnOpen || thread.status !== 'SENT') return;
    void markInquiryRead(thread.id).then(() => router.refresh());
  }, [open, markReadOnOpen, thread.id, thread.status, router]);

  async function submit() {
    setPending(true);
    setError(null);
    const result = await replyToInquiry(thread.id, body);
    setPending(false);
    if (result.ok) {
      setBody('');
      router.refresh();
    } else {
      setError(result.error === 'INQUIRY_CLOSED' ? t('closedNotice') : tc('error'));
    }
  }

  const unread = markReadOnOpen && thread.status === 'SENT';

  return (
    <article className={cn('card p-4 sm:p-5', unread && 'border-accent/40')}>
      <button
        type="button"
        className="flex w-full flex-col gap-2 text-start"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        <div className="flex flex-wrap items-center gap-2">
          {unread && <span aria-hidden className="size-1.5 rounded-full bg-accent" />}
          <h3 className={cn('text-sm text-strong', unread ? 'font-semibold' : 'font-medium')}>
            {thread.subject}
          </h3>
          <Badge tone={STATUS_TONE[thread.status]}>{tEnum(`inquiryStatus.${thread.status}`)}</Badge>
          {thread.messages.length > 1 && (
            <span className="text-[11px] text-muted">
              {t('messageCount', { count: thread.messages.length })}
            </span>
          )}
        </div>

        <p className="flex flex-wrap gap-x-2 gap-y-1 text-xs text-muted">
          <span>{thread.counterpartName}</span>
          {thread.projectName && <span>· {thread.projectName}</span>}
          <span>· {formatDate(thread.createdAt, locale)}</span>
        </p>

        {!open && (
          <p className="line-clamp-2 text-sm leading-6 text-muted">
            {thread.messages[thread.messages.length - 1]?.body}
          </p>
        )}
      </button>

      {open && (
        <div className="mt-4 animate-fade-in border-t border-line/60 pt-4">
          <ol className="space-y-3">
            {thread.messages.map((message) => (
              <li
                key={message.id}
                className={cn(
                  'max-w-[42rem] rounded-xl border p-3',
                  message.mine
                    ? 'ms-auto border-accent/30 bg-accent/[0.06]'
                    : 'border-line bg-surface-sunken/70',
                )}
              >
                <p className="mb-1 text-[11px] text-muted">
                  {message.senderName} · {formatDate(message.createdAt, locale)}
                </p>
                <p className="whitespace-pre-line text-sm leading-7 text-body">{message.body}</p>
              </li>
            ))}
          </ol>

          <div className="mt-4 flex flex-wrap items-center gap-3 text-xs">
            <a href={`mailto:${thread.contactEmail}`} className="tap-link text-info hover:underline" dir="ltr">
              {thread.contactEmail}
            </a>
            {thread.contactPhone && (
              <span className="text-muted" dir="ltr">
                {thread.contactPhone}
              </span>
            )}
            <button
              type="button"
              className="btn-ghost ms-auto text-xs"
              onClick={async () => {
                setPending(true);
                await setInquiryClosed(thread.id, !thread.closed);
                setPending(false);
                router.refresh();
              }}
            >
              {thread.closed ? t('reopen') : t('close')}
            </button>
          </div>

          {thread.closed ? (
            <p className="mt-4 rounded-xl border border-line bg-surface-sunken/60 p-3 text-xs text-muted">
              {t('closedNotice')}
            </p>
          ) : (
            <div className="mt-4">
              <Textarea
                rows={3}
                value={body}
                onChange={(event) => setBody(event.target.value)}
                placeholder={t('replyPlaceholder')}
              />
              {error && <p className="mt-2 text-xs text-danger">{error}</p>}
              <button
                type="button"
                className="btn-primary mt-3 text-xs"
                disabled={pending || body.trim().length < 2}
                onClick={submit}
              >
                {pending && <Spinner className="size-3.5" />}
                {t('reply')}
              </button>
            </div>
          )}
        </div>
      )}
    </article>
  );
}

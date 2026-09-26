'use client';

import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/routing';
import { replyToSupportThread, setSupportThreadClosed, startSupportThread } from '@/app/actions/support';
import { Field, Input, Spinner, Textarea } from '@/components/ui';

function errorText(t: (key: string) => string, code: string | undefined) {
  return code === 'RATE_LIMITED' ? t('rateLimited') : t('sendFailed');
}

/** Opens a new conversation with the admin, then goes straight to it. */
export function NewThreadForm({ basePath }: { basePath: string }) {
  const t = useTranslations('support');
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      action={async (formData) => {
        setPending(true);
        setError(null);
        const result = await startSupportThread(formData);
        setPending(false);
        if (result.ok && result.threadId) router.push(`${basePath}/${result.threadId}`);
        else setError(errorText(t, result.ok ? undefined : result.error));
      }}
    >
      <Field label={t('subject')}>
        <Input name="subject" required minLength={3} maxLength={160} />
      </Field>
      <Field label={t('message')}>
        <Textarea name="message" required minLength={2} maxLength={4000} rows={5} />
      </Field>
      {error && <p className="alert-danger mb-4">{error}</p>}
      <button type="submit" className="btn-primary text-xs" disabled={pending}>
        {pending && <Spinner />}
        {t('send')}
      </button>
    </form>
  );
}

/** Replies in a thread; Ctrl/⌘+Enter sends. */
export function ReplyForm({ threadId }: { threadId: string }) {
  const t = useTranslations('support');
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      ref={formRef}
      className="flex flex-col gap-3 sm:flex-row sm:items-end"
      action={async (formData) => {
        setPending(true);
        setError(null);
        const result = await replyToSupportThread(threadId, formData);
        setPending(false);
        if (result.ok) {
          formRef.current?.reset();
          router.refresh();
        } else setError(errorText(t, result.error));
      }}
    >
      <div className="flex-1">
        <Textarea
          name="message"
          required
          minLength={2}
          maxLength={4000}
          rows={3}
          placeholder={t('replyPlaceholder')}
          aria-label={t('message')}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) formRef.current?.requestSubmit();
          }}
        />
        {error && <p className="mt-2 text-xs text-danger">{error}</p>}
      </div>
      <button type="submit" className="btn-primary text-xs" disabled={pending}>
        {pending && <Spinner />}
        {t('send')}
      </button>
    </form>
  );
}

export function CloseThreadButton({ threadId, closed }: { threadId: string; closed: boolean }) {
  const t = useTranslations('support');
  const router = useRouter();
  const [pending, setPending] = useState(false);
  return (
    <button
      type="button"
      className="btn-ghost text-xs"
      disabled={pending}
      onClick={async () => {
        setPending(true);
        await setSupportThreadClosed(threadId, !closed);
        setPending(false);
        router.refresh();
      }}
    >
      {closed ? t('reopen') : t('close')}
    </button>
  );
}

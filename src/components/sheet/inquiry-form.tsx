'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Field, Input, Spinner, Textarea } from '@/components/ui';

export function InquiryButton({
  projectId,
  projectName,
  targetType,
  targetId,
  targetName,
  className,
}: {
  projectId?: string;
  projectName?: string;
  targetType: 'DOP' | 'VENDOR';
  targetId: string;
  targetName: string;
  className?: string;
}) {
  const t = useTranslations('inquiry');
  const tc = useTranslations('common');
  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const openerRef = useRef<HTMLButtonElement | null>(null);

  const close = useCallback(() => {
    setOpen(false);
    openerRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    document.addEventListener('keydown', onKey);
    // Keep the page behind the dialog from scrolling under it.
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    dialogRef.current?.querySelector<HTMLInputElement>('input, textarea')?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [open, close]);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const form = new FormData(event.currentTarget);

    const response = await fetch('/api/inquiries', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        projectId,
        targetType,
        targetId,
        subject: String(form.get('subject') ?? ''),
        message: String(form.get('message') ?? ''),
        contactEmail: String(form.get('contactEmail') ?? ''),
        contactPhone: String(form.get('contactPhone') ?? ''),
      }),
    });

    setPending(false);
    if (!response.ok) {
      setError(tc('error'));
      return;
    }
    setSent(true);
  }

  if (sent) {
    return (
      <span className={`inline-flex animate-fade-in items-center gap-1.5 text-xs text-success ${className ?? ''}`}>
        <svg aria-hidden viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 6 9 17l-5-5" />
        </svg>
        {t('sent')}
      </span>
    );
  }

  return (
    <>
      <button
        ref={openerRef}
        type="button"
        className={`btn-secondary text-xs ${className ?? ''}`}
        onClick={() => setOpen(true)}
      >
        {t('send')}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex animate-fade-in items-end justify-center bg-page/70 backdrop-blur-sm sm:items-center sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-label={t('title')}
          onMouseDown={(event) => {
            // Backdrop click closes; a drag that starts inside does not.
            if (event.target === event.currentTarget) close();
          }}
        >
          <div
            ref={dialogRef}
            className="card max-h-[92dvh] w-full max-w-lg animate-scale-in overflow-y-auto rounded-b-none p-5 shadow-lift sm:max-h-[85dvh] sm:rounded-2xl"
          >
            <header className="mb-4">
              <h2 className="text-base font-semibold text-strong">{t('title')}</h2>
              <p className="mt-1 text-xs text-muted">
                {targetType === 'DOP' ? t('toDop', { name: targetName }) : t('toVendor', { name: targetName })}
              </p>
            </header>

            <form onSubmit={onSubmit}>
              <Field label={t('subject')}>
                <Input
                  name="subject"
                  required
                  defaultValue={projectName ? t('defaultSubject', { project: projectName }) : ''}
                />
              </Field>
              <Field label={t('message')}>
                <Textarea name="message" required rows={5} minLength={10} />
              </Field>
              <div className="grid gap-x-4 sm:grid-cols-2">
                <Field label={t('contactEmail')}>
                  <Input name="contactEmail" type="email" required dir="ltr" />
                </Field>
                <Field label={t('contactPhone')}>
                  <Input name="contactPhone" type="tel" dir="ltr" />
                </Field>
              </div>

              {error && <p className="mb-3 text-xs text-danger">{error}</p>}

              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <button type="button" className="btn-ghost text-xs" onClick={close}>
                  {tc('cancel')}
                </button>
                <button type="submit" className="btn-primary text-xs" disabled={pending}>
                  {pending && <Spinner className="size-3.5" />}
                  {pending ? tc('loading') : t('send')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

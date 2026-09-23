'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Field, Input, Textarea } from '@/components/ui';

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
    return <span className={`text-xs text-info ${className ?? ''}`}>{t('sent')}</span>;
  }

  return (
    <>
      <button type="button" className={`btn-secondary text-xs ${className ?? ''}`} onClick={() => setOpen(true)}>
        {t('send')}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-page/80 p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="card w-full max-w-lg p-5">
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

              <div className="flex justify-end gap-2">
                <button type="button" className="btn-ghost text-xs" onClick={() => setOpen(false)}>
                  {tc('cancel')}
                </button>
                <button type="submit" className="btn-primary text-xs" disabled={pending}>
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

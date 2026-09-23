'use client';

import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/routing';
import { Field, Input } from '@/components/ui';

export function ForgotPasswordForm() {
  const t = useTranslations('auth');
  const locale = useLocale();
  const [sent, setSent] = useState(false);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    const form = new FormData(event.currentTarget);
    await fetch('/api/auth/forgot', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: String(form.get('email') ?? ''), locale }),
    });
    setPending(false);
    // Always the same confirmation, so the form cannot reveal who has an account.
    setSent(true);
  }

  if (sent) {
    return <p className="rounded-lg border border-info/40 bg-info/10 p-3 text-sm text-info">{t('resetSent')}</p>;
  }

  return (
    <form onSubmit={onSubmit} noValidate>
      <Field label={t('email')} hint={t('forgotHint')}>
        <Input name="email" type="email" required autoComplete="email" dir="ltr" />
      </Field>
      <button type="submit" className="btn-primary w-full" disabled={pending}>
        {t('sendResetLink')}
      </button>
    </form>
  );
}

const REASONS: Record<string, string> = {
  INVALID: 'resetInvalid',
  EXPIRED: 'resetExpired',
  USED: 'resetUsed',
};

export function ResetPasswordForm({ token }: { token: string }) {
  const t = useTranslations('auth');
  const tc = useTranslations('common');
  const router = useRouter();
  const [status, setStatus] = useState<'checking' | 'valid' | 'invalid'>('checking');
  const [reason, setReason] = useState<string>('INVALID');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);

  // Tell the user a dead link is dead before they pick a password.
  useEffect(() => {
    let active = true;
    (async () => {
      const response = await fetch(`/api/auth/reset?token=${encodeURIComponent(token)}`);
      const data = (await response.json().catch(() => ({}))) as { valid?: boolean; reason?: string };
      if (!active) return;
      if (data.valid) setStatus('valid');
      else {
        setReason(data.reason ?? 'INVALID');
        setStatus('invalid');
      }
    })();
    return () => {
      active = false;
    };
  }, [token]);

  if (status === 'checking') return <p className="text-sm text-muted">{tc('loading')}</p>;

  if (done) {
    return <p className="rounded-lg border border-info/40 bg-info/10 p-3 text-sm text-info">{t('resetDone')}</p>;
  }

  if (status === 'invalid') {
    return (
      <div>
        <p className="rounded-lg border border-danger/40 bg-danger/10 p-3 text-sm text-danger">
          {t(REASONS[reason] ?? 'resetInvalid')}
        </p>
        <button type="button" className="btn-secondary mt-4 w-full" onClick={() => router.replace('/forgot-password')}>
          {t('sendResetLink')}
        </button>
      </div>
    );
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const password = String(form.get('password') ?? '');
    if (password !== String(form.get('confirm') ?? '')) {
      setError(t('passwordMismatch'));
      return;
    }

    setPending(true);
    setError(null);
    const response = await fetch('/api/auth/reset', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token, password }),
    });

    if (!response.ok) {
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      setPending(false);
      setError(t(REASONS[data.error ?? ''] ?? 'resetInvalid'));
      return;
    }

    setPending(false);
    setDone(true);
    // Straight to sign-in, where the new password is used once.
    setTimeout(() => router.replace('/login'), 1200);
  }

  return (
    <form onSubmit={onSubmit} noValidate>
      <Field label={t('newPassword')}>
        <Input name="password" type="password" required minLength={8} autoComplete="new-password" dir="ltr" />
      </Field>
      <Field label={t('confirmPassword')} error={error}>
        <Input name="confirm" type="password" required minLength={8} autoComplete="new-password" dir="ltr" />
      </Field>
      <button type="submit" className="btn-primary w-full" disabled={pending}>
        {pending ? tc('loading') : t('setNewPassword')}
      </button>
    </form>
  );
}


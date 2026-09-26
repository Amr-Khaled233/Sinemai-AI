'use client';

import { useState } from 'react';
import { getSession, signIn } from 'next-auth/react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/routing';
import { Field, Input, Spinner } from '@/components/ui';

const HOME_BY_ROLE: Record<string, string> = {
  ADMIN: '/admin',
  VENDOR: '/vendor',
  DOP: '/dop',
  PRODUCER: '/producer',
};

async function homeForCurrentSession() {
  const session = await getSession();
  const role = (session?.user as { role?: string } | undefined)?.role ?? 'PRODUCER';
  return HOME_BY_ROLE[role] ?? '/producer';
}

export function SignInForm() {
  const t = useTranslations('auth');
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const form = new FormData(event.currentTarget);
    const result = await signIn('credentials', {
      email: String(form.get('email') ?? ''),
      password: String(form.get('password') ?? ''),
      redirect: false,
    });
    setPending(false);
    if (!result || result.error) {
      setError(t('invalid'));
      return;
    }
    router.replace(await homeForCurrentSession());
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} noValidate>
      <Field label={t('email')}>
        <Input name="email" type="email" required autoComplete="email" dir="ltr" />
      </Field>
      <Field label={t('password')} error={error}>
        <Input name="password" type="password" required autoComplete="current-password" dir="ltr" />
      </Field>
      <button type="submit" className="btn-primary w-full" disabled={pending}>
        {pending && <Spinner className="size-4" />}
        {t('submitSignIn')}
      </button>
    </form>
  );
}

export function SignUpForm({ locale }: { locale: string }) {
  const t = useTranslations('auth');
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const form = new FormData(event.currentTarget);
    const payload = {
      name: String(form.get('name') ?? ''),
      email: String(form.get('email') ?? ''),
      password: String(form.get('password') ?? ''),
      phone: String(form.get('phone') ?? ''),
      locale,
    };

    const response = await fetch('/api/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      setPending(false);
      setError(data.error === 'EMAIL_TAKEN' ? t('emailTaken') : t('invalid'));
      return;
    }

    await signIn('credentials', {
      email: payload.email,
      password: payload.password,
      redirect: false,
    });
    router.replace(await homeForCurrentSession());
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} noValidate>
      <Field label={t('name')}>
        <Input name="name" required autoComplete="name" />
      </Field>

      <div className="grid gap-x-4 sm:grid-cols-2">
        <Field label={t('email')}>
          <Input name="email" type="email" required autoComplete="email" dir="ltr" />
        </Field>
        <Field label={t('phone')}>
          <Input name="phone" type="tel" autoComplete="tel" dir="ltr" placeholder="+966 5x xxx xxxx" />
        </Field>
      </div>

      <Field label={t('password')}>
        <Input name="password" type="password" required minLength={8} autoComplete="new-password" dir="ltr" />
      </Field>

      {error && (
        <p className="alert-danger mb-4" role="alert">
          {error}
        </p>
      )}

      <button type="submit" className="btn-primary w-full" disabled={pending}>
        {pending && <Spinner className="size-4" />}
        {pending ? t('created') : t('submitSignUp')}
      </button>
    </form>
  );
}

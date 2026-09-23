'use client';

import { useState } from 'react';
import { getSession, signIn } from 'next-auth/react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/routing';
import { Field, Input, Select } from '@/components/ui';

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
        {t('submitSignIn')}
      </button>
    </form>
  );
}

type Role = 'PRODUCER' | 'VENDOR' | 'DOP';

export function SignUpForm({ locale }: { locale: string }) {
  const t = useTranslations('auth');
  const router = useRouter();
  const [role, setRole] = useState<Role>('PRODUCER');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
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
      role,
      locale,
      companyName: String(form.get('companyName') ?? '') || undefined,
      crNumber: String(form.get('crNumber') ?? '') || undefined,
      city: String(form.get('city') ?? '') || undefined,
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

    setNotice(t('created'));
    await signIn('credentials', {
      email: payload.email,
      password: payload.password,
      redirect: false,
    });
    setPending(false);
    router.replace(await homeForCurrentSession());
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} noValidate>
      <Field label={t('role')}>
        <Select name="role" value={role} onChange={(e) => setRole(e.target.value as Role)}>
          <option value="PRODUCER">{t('roleProducer')}</option>
          <option value="VENDOR">{t('roleVendor')}</option>
          <option value="DOP">{t('roleDop')}</option>
        </Select>
      </Field>

      <Field label={t('name')}>
        <Input name="name" required autoComplete="name" />
      </Field>

      <div className="grid gap-x-4 sm:grid-cols-2">
        <Field label={t('email')}>
          <Input name="email" type="email" required autoComplete="email" dir="ltr" />
        </Field>
        <Field label={t('phone')}>
          <Input name="phone" type="tel" dir="ltr" placeholder="+9665…" />
        </Field>
      </div>

      <Field label={t('password')}>
        <Input name="password" type="password" required minLength={8} autoComplete="new-password" dir="ltr" />
      </Field>

      {role === 'VENDOR' && (
        <div className="mb-2 rounded-lg border border-ink-600/70 bg-ink-900/50 p-4">
          <Field label={t('companyName')}>
            <Input name="companyName" required />
          </Field>
          <div className="grid gap-x-4 sm:grid-cols-2">
            <Field label={t('crNumber')}>
              <Input name="crNumber" dir="ltr" inputMode="numeric" />
            </Field>
            <Field label={t('city')}>
              <Input name="city" required defaultValue="Riyadh" />
            </Field>
          </div>
        </div>
      )}

      {role === 'DOP' && (
        <Field label={t('city')}>
          <Input name="city" defaultValue="Riyadh" />
        </Field>
      )}

      {role !== 'PRODUCER' && (
        <p className="mb-4 rounded-lg border border-brass-600/40 bg-brass-500/5 p-3 text-xs text-brass-300">
          {t('pendingNotice')}
        </p>
      )}

      {error && <p className="mb-3 text-sm text-red-400">{error}</p>}
      {notice && <p className="mb-3 text-sm text-teal-400">{notice}</p>}

      <button type="submit" className="btn-primary w-full" disabled={pending}>
        {t('submitSignUp')}
      </button>
    </form>
  );
}

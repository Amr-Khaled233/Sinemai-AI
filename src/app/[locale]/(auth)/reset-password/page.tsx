import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/routing';
import { ResetPasswordForm } from '@/components/password-forms';
import { AuthPanel } from '@/components/auth-panel';
import type { AppLocale } from '@/i18n/routing';

export const dynamic = 'force-dynamic';

export default async function ResetPasswordPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ token?: string }>;
}) {
  const [{ locale }, { token }] = await Promise.all([params, searchParams]);
  setRequestLocale(locale as AppLocale);
  const t = await getTranslations('auth');

  return (
    <AuthPanel
      title={t('resetTitle')}
      subtitle={t('resetSubtitle')}
      footer={
        <Link href="/login" className="tap-link text-accent hover:underline">
          {t('backToSignIn')}
        </Link>
      }
    >
      {token ? <ResetPasswordForm token={token} /> : <p className="alert-danger">{t('resetInvalid')}</p>}
    </AuthPanel>
  );
}

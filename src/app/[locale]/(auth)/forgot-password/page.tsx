import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/routing';
import { ForgotPasswordForm } from '@/components/password-forms';
import { AuthPanel } from '@/components/auth-panel';
import type { AppLocale } from '@/i18n/routing';

export default async function ForgotPasswordPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale as AppLocale);
  const t = await getTranslations('auth');

  return (
    <AuthPanel
      title={t('forgotTitle')}
      subtitle={t('forgotSubtitle')}
      footer={
        <Link href="/login" className="tap-link text-accent hover:underline">
          {t('backToSignIn')}
        </Link>
      }
    >
      <ForgotPasswordForm />
    </AuthPanel>
  );
}

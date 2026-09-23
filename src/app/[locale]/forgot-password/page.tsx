import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/routing';
import { ForgotPasswordForm } from '@/components/password-forms';
import { Card } from '@/components/ui';
import type { AppLocale } from '@/i18n/routing';

export default async function ForgotPasswordPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale as AppLocale);
  const t = await getTranslations('auth');

  return (
    <div className="mx-auto max-w-md animate-fade-up pt-4 sm:pt-10">
      <Card title={t('forgotTitle')} subtitle={t('forgotSubtitle')}>
        <ForgotPasswordForm />
        <p className="mt-5 text-xs text-muted">
          <Link href="/login" className="text-accent hover:underline">
            {t('backToSignIn')}
          </Link>
        </p>
      </Card>
    </div>
  );
}

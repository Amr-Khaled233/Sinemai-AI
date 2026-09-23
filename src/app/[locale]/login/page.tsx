import { getTranslations, setRequestLocale } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { Link } from '@/i18n/routing';
import { auth, homeForRole } from '@/lib/auth';
import { SignInForm } from '@/components/auth-forms';
import { Card } from '@/components/ui';
import type { AppLocale } from '@/i18n/routing';

export default async function LoginPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale as AppLocale);

  const session = await auth();
  if (session?.user) redirect(`/${locale}${homeForRole(session.user.role)}`);

  const t = await getTranslations('auth');

  return (
    <div className="mx-auto max-w-md animate-fade-up pt-4 sm:pt-10">
      <Card title={t('signInTitle')} subtitle={t('signInSubtitle')}>
        <SignInForm />
        <p className="mt-4 text-xs">
          <Link href="/forgot-password" className="tap-link text-accent hover:underline">
            {t('forgotPassword')}
          </Link>
        </p>
        <p className="mt-2 text-xs text-muted">
          {t('noAccount')}{' '}
          <Link href="/register" className="tap-link text-accent hover:underline">
            {t('signUpTitle')}
          </Link>
        </p>
      </Card>
    </div>
  );
}

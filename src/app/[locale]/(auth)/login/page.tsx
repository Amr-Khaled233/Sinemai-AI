import { getTranslations, setRequestLocale } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { Link } from '@/i18n/routing';
import { auth, homeForRole } from '@/lib/auth';
import { SignInForm } from '@/components/auth-forms';
import { AuthPanel } from '@/components/auth-panel';
import type { AppLocale } from '@/i18n/routing';

export default async function LoginPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale as AppLocale);

  const session = await auth();
  if (session?.user) redirect(`/${locale}${homeForRole(session.user.role)}`);

  const t = await getTranslations('auth');

  return (
    <AuthPanel
      title={t('signInTitle')}
      subtitle={t('signInSubtitle')}
      footer={
        <>
          <p>
            <Link href="/forgot-password" className="tap-link text-accent hover:underline">
              {t('forgotPassword')}
            </Link>
          </p>
          <p>
            {t('noAccount')}{' '}
            <Link href="/register" className="tap-link font-medium text-accent hover:underline">
              {t('signUpTitle')}
            </Link>
          </p>
        </>
      }
    >
      <SignInForm />
    </AuthPanel>
  );
}

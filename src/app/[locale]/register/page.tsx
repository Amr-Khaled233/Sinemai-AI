import { getTranslations, setRequestLocale } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { Link } from '@/i18n/routing';
import { auth, homeForRole } from '@/lib/auth';
import { SignUpForm } from '@/components/auth-forms';
import { Card } from '@/components/ui';
import type { AppLocale } from '@/i18n/routing';

export default async function RegisterPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale as AppLocale);

  const session = await auth();
  if (session?.user) redirect(`/${locale}${homeForRole(session.user.role)}`);

  const t = await getTranslations('auth');

  return (
    <div className="mx-auto max-w-lg">
      <Card title={t('signUpTitle')} subtitle={t('signUpSubtitle')}>
        <SignUpForm locale={locale} />
        <p className="mt-5 text-xs text-muted">
          {t('haveAccount')}{' '}
          <Link href="/login" className="text-accent hover:underline">
            {t('signInTitle')}
          </Link>
        </p>
      </Card>
    </div>
  );
}

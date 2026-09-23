import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/routing';
import { ResetPasswordForm } from '@/components/password-forms';
import { Card } from '@/components/ui';
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
    <div className="mx-auto max-w-md">
      <Card title={t('resetTitle')} subtitle={t('resetSubtitle')}>
        {token ? (
          <ResetPasswordForm token={token} />
        ) : (
          <p className="rounded-lg border border-danger/40 bg-danger/10 p-3 text-sm text-danger">
            {t('resetInvalid')}
          </p>
        )}
        <p className="mt-5 text-xs text-muted">
          <Link href="/login" className="text-accent hover:underline">
            {t('backToSignIn')}
          </Link>
        </p>
      </Card>
    </div>
  );
}

import { getTranslations, setRequestLocale } from 'next-intl/server';
import { requireRole } from '@/lib/auth';
import { listThreads } from '@/lib/support';
import { Card } from '@/components/ui';
import { ThreadList } from '@/components/support/support-views';
import { NewThreadForm } from '@/components/support/support-forms';
import type { AppLocale } from '@/i18n/routing';

export default async function UserSupportPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale as AppLocale);
  const session = await requireRole(['PRODUCER', 'ADMIN'], locale);

  const [t, threads] = await Promise.all([
    getTranslations('support'),
    listThreads({ id: session.user.id, isAdmin: false }),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-strong">{t('title')}</h1>
        <p className="mt-1 text-sm text-muted">{t('userHint')}</p>
      </div>
      <div className="grid gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-2" title={t('newConversation')}>
          <NewThreadForm basePath="/producer/support" />
        </Card>
        <Card className="lg:col-span-3" title={t('yourConversations')}>
          <ThreadList threads={threads} basePath="/producer/support" locale={locale} showUser={false} />
        </Card>
      </div>
    </div>
  );
}

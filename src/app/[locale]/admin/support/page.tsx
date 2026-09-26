import { getTranslations, setRequestLocale } from 'next-intl/server';
import { requireRole } from '@/lib/auth';
import { listThreads } from '@/lib/support';
import { Card } from '@/components/ui';
import { ThreadList } from '@/components/support/support-views';
import type { AppLocale } from '@/i18n/routing';

export default async function AdminSupportPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale as AppLocale);
  const session = await requireRole('ADMIN', locale);

  const [t, threads] = await Promise.all([
    getTranslations('support'),
    listThreads({ id: session.user.id, isAdmin: true }),
  ]);
  // Waiting on the admin first, then everything else by activity.
  const ordered = [...threads.filter((thread) => thread.unread), ...threads.filter((thread) => !thread.unread)];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-strong">{t('title')}</h1>
        <p className="mt-1 text-sm text-muted">{t('adminHint')}</p>
      </div>
      <Card>
        <ThreadList threads={ordered} basePath="/admin/support" locale={locale} showUser />
      </Card>
    </div>
  );
}

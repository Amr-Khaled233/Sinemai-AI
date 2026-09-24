import { getTranslations, setRequestLocale } from 'next-intl/server';
import { requireRole } from '@/lib/auth';
import { loadReceivedThreads } from '@/lib/inquiries';
import { InquiryThread } from '@/components/inquiry-thread';
import { EmptyState, SectionTitle } from '@/components/ui';
import type { AppLocale } from '@/i18n/routing';

export default async function VendorInquiriesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale as AppLocale);

  const session = await requireRole('VENDOR', locale);
  const [t, threads] = await Promise.all([
    getTranslations('inquiry'),
    loadReceivedThreads(session.user.id, 'vendor'),
  ]);

  return (
    <div>
      <SectionTitle hint={t('receivedHint')}>{t('received')}</SectionTitle>
      {threads.length === 0 ? (
        <EmptyState title={t('empty')} />
      ) : (
        <div className="space-y-3">
          {threads.map((thread) => (
            <InquiryThread key={thread.id} thread={thread} locale={locale} markReadOnOpen />
          ))}
        </div>
      )}
    </div>
  );
}

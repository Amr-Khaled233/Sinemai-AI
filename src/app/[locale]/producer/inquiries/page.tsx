import { getTranslations, setRequestLocale } from 'next-intl/server';
import { requireRole } from '@/lib/auth';
import { loadSentThreads } from '@/lib/inquiries';
import { InquiryThread } from '@/components/inquiry-thread';
import { EmptyState, SectionTitle } from '@/components/ui';
import type { AppLocale } from '@/i18n/routing';

export default async function ProducerInquiriesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale as AppLocale);

  const session = await requireRole(['PRODUCER', 'ADMIN'], locale);
  const [t, threads] = await Promise.all([getTranslations('inquiry'), loadSentThreads(session.user.id)]);

  return (
    <div>
      <SectionTitle hint={t('sentHint')}>{t('sent')}</SectionTitle>
      {threads.length === 0 ? (
        <EmptyState title={t('emptySent')} />
      ) : (
        <div className="space-y-3">
          {threads.map((thread) => (
            <InquiryThread key={thread.id} thread={thread} locale={locale} />
          ))}
        </div>
      )}
    </div>
  );
}

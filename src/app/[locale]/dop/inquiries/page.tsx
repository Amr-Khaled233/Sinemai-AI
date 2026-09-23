import { getTranslations, setRequestLocale } from 'next-intl/server';
import { requireRole } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { InquiriesList } from '@/components/inquiries-list';
import { SectionTitle } from '@/components/ui';
import type { AppLocale } from '@/i18n/routing';

export default async function DopInquiriesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale as AppLocale);

  const session = await requireRole('DOP', locale);
  const t = await getTranslations('inquiry');

  const inquiries = await prisma.inquiry.findMany({
    where: { dop: { userId: session.user.id } },
    orderBy: { createdAt: 'desc' },
    include: { fromUser: { select: { name: true } }, project: { select: { name: true } } },
  });

  return (
    <div>
      <SectionTitle>{t('received')}</SectionTitle>
      <InquiriesList inquiries={inquiries} locale={locale} />
    </div>
  );
}

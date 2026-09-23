import { getTranslations } from 'next-intl/server';
import { Card, EmptyState } from '@/components/ui';
import { formatDate } from '@/lib/utils';

export type InquiryRow = {
  id: string;
  subject: string;
  message: string;
  contactEmail: string;
  contactPhone: string | null;
  createdAt: Date;
  fromUser: { name: string };
  project: { name: string } | null;
};

export async function InquiriesList({ inquiries, locale }: { inquiries: InquiryRow[]; locale: string }) {
  const t = await getTranslations('inquiry');

  if (inquiries.length === 0) return <EmptyState title={t('empty')} />;

  return (
    <div className="space-y-4">
      {inquiries.map((inquiry) => (
        <Card key={inquiry.id} title={inquiry.subject}>
          <p className="mb-3 flex flex-wrap gap-2 text-xs text-muted">
            <span>
              {t('from')}: {inquiry.fromUser.name}
            </span>
            {inquiry.project && <span>· {inquiry.project.name}</span>}
            <span>· {formatDate(inquiry.createdAt, locale)}</span>
          </p>
          <p className="whitespace-pre-line text-sm leading-7 text-body/90">{inquiry.message}</p>
          <p className="mt-4 text-xs">
            <a href={`mailto:${inquiry.contactEmail}`} className="tap-link text-info hover:underline" dir="ltr">
              {inquiry.contactEmail}
            </a>
            {inquiry.contactPhone && (
              <span className="ms-3 text-muted" dir="ltr">
                {inquiry.contactPhone}
              </span>
            )}
          </p>
        </Card>
      ))}
    </div>
  );
}

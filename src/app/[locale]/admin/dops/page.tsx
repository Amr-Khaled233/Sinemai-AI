import { getTranslations, setRequestLocale } from 'next-intl/server';
import { requireRole } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { Card } from '@/components/ui';
import { ApprovalTable } from '@/components/admin/approval-table';
import { ReembedButton } from '@/components/admin/reembed-button';
import { formatDate, truncate } from '@/lib/utils';
import type { AppLocale } from '@/i18n/routing';

export default async function AdminDopsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale as AppLocale);
  await requireRole('ADMIN', locale);

  const t = await getTranslations('admin');
  const dops = await prisma.dop.findMany({
    orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    include: { user: { select: { email: true } } },
  });

  const rows = dops.map((dop) => ({
    id: dop.id,
    title: dop.displayName,
    subtitle: [dop.city, dop.user.email, dop.dayRate ? `${dop.dayRate} SAR/day` : null]
      .filter(Boolean)
      .join(' · '),
    detail: truncate(dop.bio, 320),
    status: dop.status,
    tags: dop.styleTags,
    links: dop.portfolioLinks,
    meta: dop.embeddedAt
      ? `Style vector: ${formatDate(dop.embeddedAt, locale)}`
      : 'No style vector yet — this profile cannot be matched.',
  }));

  const pending = rows.filter((row) => row.status === 'PENDING');
  const rest = rows.filter((row) => row.status !== 'PENDING');

  return (
    <div className="space-y-6">
      <Card title={`${t('pendingApprovals')} · ${pending.length}`} action={<ReembedButton />}>
        <ApprovalTable kind="DOP" rows={pending} />
      </Card>
      <Card title={t('dopsTitle')}>
        <ApprovalTable kind="DOP" rows={rest} />
      </Card>
    </div>
  );
}

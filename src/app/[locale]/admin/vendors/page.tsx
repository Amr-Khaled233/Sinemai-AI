import { getTranslations, setRequestLocale } from 'next-intl/server';
import { requireRole } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { Card } from '@/components/ui';
import { ApprovalTable } from '@/components/admin/approval-table';
import type { AppLocale } from '@/i18n/routing';

export default async function AdminVendorsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale as AppLocale);
  await requireRole('ADMIN', locale);

  const t = await getTranslations('admin');
  const vendors = await prisma.vendor.findMany({
    orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    include: {
      user: { select: { email: true, name: true, phone: true } },
      company: true,
      _count: { select: { inventory: true } },
    },
  });

  const rows = vendors.map((vendor) => ({
    id: vendor.id,
    title: vendor.company.name,
    subtitle: [vendor.company.city, vendor.user.email, vendor.user.phone].filter(Boolean).join(' · '),
    detail: [
      vendor.company.crNumber ? `CR ${vendor.company.crNumber}` : null,
      `${vendor._count.inventory} inventory item(s)`,
      vendor.company.website,
      vendor.notes ? `Note: ${vendor.notes}` : null,
    ]
      .filter(Boolean)
      .join(' · '),
    status: vendor.status,
    verified: vendor.verified,
  }));

  const pending = rows.filter((row) => row.status === 'PENDING');
  const rest = rows.filter((row) => row.status !== 'PENDING');

  return (
    <div className="space-y-6">
      <Card title={`${t('pendingApprovals')} · ${pending.length}`}>
        <ApprovalTable kind="VENDOR" rows={pending} />
      </Card>
      <Card title={t('vendorsTitle')}>
        <ApprovalTable kind="VENDOR" rows={rest} />
      </Card>
    </div>
  );
}

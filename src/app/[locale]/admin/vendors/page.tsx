import { getTranslations, setRequestLocale } from 'next-intl/server';
import { requireRole } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { Card } from '@/components/ui';
import { CompanyManager } from '@/components/admin/company-manager';
import type { AppLocale } from '@/i18n/routing';

export default async function AdminVendorsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale as AppLocale);
  await requireRole('ADMIN', locale);

  const [t, vendors] = await Promise.all([
    getTranslations('admin'),
    prisma.vendor.findMany({
      orderBy: { company: { name: 'asc' } },
      include: { company: true, _count: { select: { inventory: true } } },
    }),
  ]);

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-strong">{t('vendorsTitle')}</h1>
      <Card subtitle={t('vendorsHint')}>
        <CompanyManager
          rows={vendors.map((vendor) => ({
            id: vendor.id,
            name: vendor.company.name,
            city: vendor.company.city,
            phone: vendor.company.phone,
            email: vendor.company.email,
            website: vendor.company.website,
            crNumber: vendor.company.crNumber,
            items: vendor._count.inventory,
            active: vendor.status === 'APPROVED',
          }))}
        />
      </Card>
    </div>
  );
}

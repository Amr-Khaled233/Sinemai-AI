import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/routing';
import { requireRole } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { updateCompanyProfileForm } from '@/app/actions/vendor';
import { Badge, Card, Field, Input, Stat } from '@/components/ui';
import type { AppLocale } from '@/i18n/routing';

export default async function VendorHome({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale as AppLocale);

  const session = await requireRole('VENDOR', locale);
  const [t, tEnum, tNav] = await Promise.all([
    getTranslations('vendor'),
    getTranslations('enum'),
    getTranslations('nav'),
  ]);

  const vendor = await prisma.vendor.findUnique({
    where: { userId: session.user.id },
    include: {
      company: true,
      _count: { select: { inventory: true, inquiries: true } },
    },
  });

  if (!vendor) {
    return <Card title={t('title')}>No vendor profile is attached to this account.</Card>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-strong">{t('title')}</h1>
        <div className="flex items-center gap-2">
          <Badge tone={vendor.status === 'APPROVED' ? 'green' : vendor.status === 'REJECTED' ? 'red' : 'amber'}>
            {tEnum(`approval.${vendor.status}`)}
          </Badge>
          {vendor.verified && <Badge tone="teal">{t('verified')}</Badge>}
        </div>
      </div>

      {vendor.status === 'PENDING' && (
        <p className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-xs text-warning">
          {t('pending')}
        </p>
      )}
      {vendor.status === 'REJECTED' && (
        <p className="rounded-lg border border-danger/40 bg-danger/10 p-3 text-xs text-danger">
          {t('rejected')}
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label={t('inventoryTitle')} value={vendor._count.inventory} />
        <Stat label={tNav('inquiries')} value={vendor._count.inquiries} />
        <Stat label={t('city')} value={vendor.company.city} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title={t('company')}>
          <form action={updateCompanyProfileForm}>
            <Field label={t('company')}>
              <Input name="name" defaultValue={vendor.company.name} required />
            </Field>
            <div className="grid gap-x-4 sm:grid-cols-2">
              <Field label={t('city')}>
                <Input name="city" defaultValue={vendor.company.city} required />
              </Field>
              <Field label="CR">
                <Input name="crNumber" defaultValue={vendor.company.crNumber ?? ''} dir="ltr" />
              </Field>
            </div>
            <div className="grid gap-x-4 sm:grid-cols-2">
              <Field label="Phone">
                <Input name="phone" defaultValue={vendor.company.phone ?? ''} dir="ltr" />
              </Field>
              <Field label="Website">
                <Input name="website" defaultValue={vendor.company.website ?? ''} dir="ltr" />
              </Field>
            </div>
            <Field label="Address">
              <Input name="addressLine" defaultValue={vendor.company.addressLine ?? ''} />
            </Field>
            <button type="submit" className="btn-primary text-xs">
              {t('save')}
            </button>
          </form>
        </Card>

        <Card title={t('inventoryTitle')} subtitle={`${vendor._count.inventory}`}>
          <Link href="/vendor/inventory" className="btn-secondary text-xs">
            {t('addItem')}
          </Link>
        </Card>
      </div>
    </div>
  );
}

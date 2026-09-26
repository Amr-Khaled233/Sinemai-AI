import { getTranslations, setRequestLocale } from 'next-intl/server';
import { requireRole } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { Card, EmptyState } from '@/components/ui';
import { InventoryManager } from '@/components/vendor/inventory-manager';
import {
  adminAddAvailabilityBlock,
  adminDeleteInventoryItem,
  adminRemoveAvailabilityBlock,
  adminSaveInventoryItem,
  adminToggleInventoryActive,
} from '@/app/actions/admin';
import type { AppLocale } from '@/i18n/routing';

/**
 * Every vendor's rental stock and prices, editable by the admin with the same
 * editor vendors use. Prices are in SAR, like every stored amount.
 */
export default async function AdminRentalsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ vendor?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale as AppLocale);
  await requireRole('ADMIN', locale);

  const [t, { vendor: requested }] = await Promise.all([getTranslations('admin'), searchParams]);

  const vendors = await prisma.vendor.findMany({
    orderBy: { company: { name: 'asc' } },
    select: {
      id: true,
      status: true,
      company: { select: { name: true, city: true } },
      _count: { select: { inventory: true } },
    },
  });

  if (vendors.length === 0) {
    return (
      <div className="space-y-6">
        <h1 className="text-xl font-semibold text-strong">{t('rentalsTitle')}</h1>
        <EmptyState title={t('rentalsNoVendors')} />
      </div>
    );
  }

  const selected = vendors.find((vendor) => vendor.id === requested) ?? vendors[0];

  const [vendor, catalog] = await Promise.all([
    prisma.vendor.findUniqueOrThrow({
      where: { id: selected.id },
      select: {
        inventory: {
          orderBy: { createdAt: 'desc' },
          include: {
            equipment: { select: { brand: true, model: true } },
            blocks: { orderBy: { startDate: 'asc' } },
          },
        },
      },
    }),
    prisma.equipment.findMany({
      where: { active: true },
      orderBy: [{ category: { sortOrder: 'asc' } }, { brand: 'asc' }],
      select: { id: true, brand: true, model: true, indicativeDayRate: true, category: { select: { slug: true } } },
    }),
  ]);

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-strong">{t('rentalsTitle')}</h1>

      <Card subtitle={t('rentalsHint')}>
        {/* A plain GET form: choosing a vendor is a link, so it works without JS and can be bookmarked. */}
        <form method="get" className="flex flex-wrap items-end gap-3">
          <div className="min-w-[16rem]">
            <label className="label" htmlFor="rentals-vendor">
              {t('rentalsVendor')}
            </label>
            <select id="rentals-vendor" name="vendor" defaultValue={selected.id} className="input">
              {vendors.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.company.name} · {option.company.city} ({option._count.inventory})
                </option>
              ))}
            </select>
          </div>
          <button type="submit" className="btn-secondary text-xs">
            {t('rentalsShow')}
          </button>
        </form>
      </Card>

      <InventoryManager
        key={selected.id}
        title={selected.company.name}
        defaultCity={selected.company.city}
        actions={{
          save: adminSaveInventoryItem.bind(null, selected.id),
          remove: adminDeleteInventoryItem.bind(null, selected.id),
          toggle: adminToggleInventoryActive.bind(null, selected.id),
          addBlock: adminAddAvailabilityBlock.bind(null, selected.id),
          removeBlock: adminRemoveAvailabilityBlock.bind(null, selected.id),
        }}
        catalog={catalog.map((item) => ({
          id: item.id,
          label: `${item.brand} ${item.model}`,
          categorySlug: item.category.slug,
          indicativeDayRate: item.indicativeDayRate,
        }))}
        items={vendor.inventory.map((item) => ({
          id: item.id,
          equipmentId: item.equipmentId,
          label: `${item.equipment.brand} ${item.equipment.model}`,
          dailyRate: item.dailyRate,
          weeklyRate: item.weeklyRate,
          monthlyRate: item.monthlyRate,
          quantityTotal: item.quantityTotal,
          quantityAvailable: item.quantityAvailable,
          city: item.city,
          notes: item.notes,
          active: item.active,
          blocks: item.blocks.map((block) => ({
            id: block.id,
            startDate: block.startDate.toISOString().slice(0, 10),
            endDate: block.endDate.toISOString().slice(0, 10),
            quantity: block.quantity,
            reason: block.reason,
          })),
        }))}
      />
    </div>
  );
}

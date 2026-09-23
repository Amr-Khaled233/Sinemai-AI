import { getTranslations, setRequestLocale } from 'next-intl/server';
import { requireRole } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { Card } from '@/components/ui';
import { InventoryManager } from '@/components/vendor/inventory-manager';
import type { AppLocale } from '@/i18n/routing';

export default async function VendorInventoryPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale as AppLocale);

  const session = await requireRole('VENDOR', locale);
  const t = await getTranslations('vendor');

  const vendor = await prisma.vendor.findUnique({
    where: { userId: session.user.id },
    select: {
      id: true,
      company: { select: { city: true } },
      inventory: {
        orderBy: { createdAt: 'desc' },
        include: {
          equipment: { select: { brand: true, model: true } },
          blocks: { orderBy: { startDate: 'asc' } },
        },
      },
    },
  });

  if (!vendor) return <Card title={t('inventoryTitle')}>No vendor profile.</Card>;

  const catalog = await prisma.equipment.findMany({
    where: { active: true },
    orderBy: [{ category: { sortOrder: 'asc' } }, { brand: 'asc' }],
    select: {
      id: true,
      brand: true,
      model: true,
      indicativeDayRate: true,
      category: { select: { slug: true } },
    },
  });

  return (
    <InventoryManager
      defaultCity={vendor.company.city}
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
  );
}

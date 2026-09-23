import { setRequestLocale } from 'next-intl/server';
import { requireRole } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { EquipmentManager } from '@/components/admin/equipment-manager';
import type { AppLocale } from '@/i18n/routing';

export default async function AdminEquipmentPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale as AppLocale);
  await requireRole('ADMIN', locale);

  const [equipment, categories] = await Promise.all([
    prisma.equipment.findMany({
      orderBy: [{ category: { sortOrder: 'asc' } }, { brand: 'asc' }, { model: 'asc' }],
      include: {
        category: { select: { slug: true } },
        _count: { select: { inventory: true } },
      },
    }),
    prisma.equipmentCategory.findMany({
      orderBy: { sortOrder: 'asc' },
      select: { id: true, slug: true, nameEn: true },
    }),
  ]);

  return (
    <EquipmentManager
      categories={categories}
      rows={equipment.map((item) => ({
        id: item.id,
        categoryId: item.categoryId,
        categorySlug: item.category.slug,
        brand: item.brand,
        model: item.model,
        nameAr: item.nameAr,
        specs: item.specs,
        summaryEn: item.summaryEn,
        summaryAr: item.summaryAr,
        lighting: item.suitableLightingComplexity,
        movement: item.suitableMovementTypes,
        tiers: item.budgetTier,
        dayNight: item.dayNightSuitability,
        capabilities: item.specialCapabilities,
        indicativeDayRate: item.indicativeDayRate,
        isCore: item.isCore,
        active: item.active,
        vendorCount: item._count.inventory,
      }))}
    />
  );
}

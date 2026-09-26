import 'server-only';
import { prisma } from '@/lib/prisma';

/**
 * Names for a set of equipment ids in one query, for pages and exports that
 * print many items. Items not in the catalog any more keep brand + model.
 */
export async function equipmentNamer(ids: string[], locale: string) {
  const rows =
    locale === 'ar' && ids.length
      ? await prisma.equipment.findMany({
          where: { id: { in: [...new Set(ids)] } },
          select: { id: true, nameAr: true },
        })
      : [];
  const arabic = new Map(rows.filter((row) => row.nameAr).map((row) => [row.id, row.nameAr as string]));
  return (item: { equipmentId: string; brand: string; model: string }) =>
    arabic.get(item.equipmentId) ?? `${item.brand} ${item.model}`;
}

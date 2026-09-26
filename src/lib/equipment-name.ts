/**
 * How a piece of equipment is named to a reader. Arabic pages use the Arabic
 * name when the catalog has one — a descriptor in Arabic with the model kept
 * in Latin, the way crews say it ("كاميرا ARRI ALEXA 35") — and fall back to
 * brand and model.
 */
export function equipmentName(
  item: { brand: string; model: string; nameAr?: string | null },
  locale: string,
): string {
  if (locale === 'ar' && item.nameAr) return item.nameAr;
  return `${item.brand} ${item.model}`;
}

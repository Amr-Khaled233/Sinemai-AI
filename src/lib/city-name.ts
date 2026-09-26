/**
 * City names are stored as typed (usually English). Arabic pages show the
 * Arabic name for the cities productions actually shoot in; anything else is
 * shown as written.
 */
const ARABIC_CITIES: Record<string, string> = {
  riyadh: 'الرياض',
  jeddah: 'جدة',
  jiddah: 'جدة',
  makkah: 'مكة المكرمة',
  mecca: 'مكة المكرمة',
  madinah: 'المدينة المنورة',
  medina: 'المدينة المنورة',
  dammam: 'الدمام',
  khobar: 'الخبر',
  'al khobar': 'الخبر',
  dhahran: 'الظهران',
  alula: 'العلا',
  'al ula': 'العلا',
  'al-ula': 'العلا',
  abha: 'أبها',
  taif: 'الطائف',
  tabuk: 'تبوك',
  neom: 'نيوم',
  yanbu: 'ينبع',
  jubail: 'الجبيل',
  hail: 'حائل',
  "ha'il": 'حائل',
  buraidah: 'بريدة',
  qassim: 'القصيم',
  jazan: 'جازان',
  jizan: 'جازان',
  najran: 'نجران',
  'al baha': 'الباحة',
  baha: 'الباحة',
  'al ahsa': 'الأحساء',
  hofuf: 'الهفوف',
  dubai: 'دبي',
  'abu dhabi': 'أبوظبي',
  cairo: 'القاهرة',
};

export function cityName(city: string | null | undefined, locale: string): string {
  if (!city) return '';
  if (locale !== 'ar') return city;
  return ARABIC_CITIES[city.trim().toLowerCase()] ?? city;
}

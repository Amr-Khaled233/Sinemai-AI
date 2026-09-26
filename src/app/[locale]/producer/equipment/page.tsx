import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { Prisma } from '@prisma/client';
import { requireRole } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { Card } from '@/components/ui';
import { moneyFormatter } from '@/lib/currency-server';
import { equipmentName } from '@/lib/equipment-name';
import type { AppLocale } from '@/i18n/routing';

/**
 * The equipment catalog as a user sees it: what exists, what it is for, and
 * what it rents for — the lowest price an active rental company asks, or the
 * indicative market rate when nobody stocks it yet.
 */
export default async function EquipmentCatalogPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ category?: string; q?: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale as AppLocale);
  await requireRole(['PRODUCER', 'ADMIN'], locale);

  const [t, money, { category = '', q = '' }] = await Promise.all([
    getTranslations('catalog'),
    moneyFormatter(locale),
    searchParams,
  ]);
  const query = q.trim().slice(0, 80);

  const where: Prisma.EquipmentWhereInput = {
    active: true,
    ...(category ? { category: { slug: category } } : {}),
    ...(query
      ? {
          OR: [
            { brand: { contains: query, mode: 'insensitive' } },
            { model: { contains: query, mode: 'insensitive' } },
            { nameAr: { contains: query, mode: 'insensitive' } },
          ],
        }
      : {}),
  };

  const [categories, items] = await Promise.all([
    prisma.equipmentCategory.findMany({ orderBy: { sortOrder: 'asc' } }),
    prisma.equipment.findMany({
      where,
      orderBy: [{ category: { sortOrder: 'asc' } }, { brand: 'asc' }, { model: 'asc' }],
      include: {
        category: true,
        inventory: {
          where: { active: true, vendor: { status: 'APPROVED' } },
          select: { dailyRate: true },
        },
      },
    }),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-strong">{t('title')}</h1>
        <p className="mt-1 text-sm text-muted">{t('subtitle')}</p>
      </div>

      <Card>
        <form method="get" className="flex flex-wrap items-end gap-3">
          <div className="w-56">
            <label className="label" htmlFor="catalog-category">
              {t('category')}
            </label>
            <select id="catalog-category" name="category" defaultValue={category} className="input">
              <option value="">{t('allCategories')}</option>
              {categories.map((option) => (
                <option key={option.slug} value={option.slug}>
                  {locale === 'ar' ? option.nameAr : option.nameEn}
                </option>
              ))}
            </select>
          </div>
          <div className="min-w-[14rem] flex-1">
            <label className="label" htmlFor="catalog-q">
              {t('search')}
            </label>
            <input id="catalog-q" name="q" className="input" dir="auto" defaultValue={query} />
          </div>
          <button type="submit" className="btn-primary text-xs">
            {t('apply')}
          </button>
        </form>

        {items.length === 0 ? (
          <p className="prose-sheet mt-5">{t('empty')}</p>
        ) : (
          <div className="table-wrap mt-5">
            <table className="grid-table [--grid-cols:minmax(12rem,1.3fr)_minmax(8rem,0.7fr)_minmax(14rem,2fr)_minmax(8rem,0.8fr)]">
              <thead>
                <tr>
                  <th>{t('item')}</th>
                  <th>{t('category')}</th>
                  <th>{t('about')}</th>
                  <th className="text-end">{t('dayRate')}</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => {
                  const best = item.inventory.length
                    ? Math.min(...item.inventory.map((row) => row.dailyRate))
                    : null;
                  const summary = locale === 'ar' && item.summaryAr ? item.summaryAr : item.summaryEn;
                  return (
                    <tr key={item.id}>
                      <td data-label={t('item')} className="font-medium text-strong">
                        {equipmentName(item, locale)}
                      </td>
                      <td data-label={t('category')} className="text-muted">
                        {locale === 'ar' ? item.category.nameAr : item.category.nameEn}
                      </td>
                      <td data-label={t('about')} className="text-sm leading-6 text-muted" dir="auto">
                        {summary || '—'}
                      </td>
                      <td data-label={t('dayRate')} className="text-end">
                        {best !== null ? (
                          <>
                            <span className="block tabular-nums text-strong">{t('from', { price: money(best) })}</span>
                            <span className="text-[11px] text-muted">
                              {t('companies', { count: item.inventory.length })}
                            </span>
                          </>
                        ) : item.indicativeDayRate ? (
                          <>
                            <span className="block tabular-nums text-strong">~{money(item.indicativeDayRate)}</span>
                            <span className="text-[11px] text-muted">{t('indicative')}</span>
                          </>
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

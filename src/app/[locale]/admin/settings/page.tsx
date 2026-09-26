import { getTranslations, setRequestLocale } from 'next-intl/server';
import { BudgetTier } from '@prisma/client';
import { requireRole } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { getBudgetTierConfigs, getSettings } from '@/lib/settings';
import { saveCrewRateForm, savePlatformSettingsForm, saveStyleTagForm } from '@/app/actions/admin';
import { Card, Field, Input } from '@/components/ui';
import { StyleTagToggles } from '@/components/admin/style-tag-toggles';
import { CurrencyManager } from '@/components/admin/currency-manager';
import { getCurrencyConfig } from '@/lib/currency-server';
import type { AppLocale } from '@/i18n/routing';

export default async function AdminSettingsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale as AppLocale);
  await requireRole('ADMIN', locale);

  const [t, tEnum, settings, tiers, crewRates, styleTags, currencies] = await Promise.all([
    getTranslations('admin'),
    getTranslations('enum'),
    getSettings(),
    getBudgetTierConfigs(),
    prisma.crewRate.findMany({ orderBy: [{ dayRate: 'desc' }, { roleSlug: 'asc' }] }),
    prisma.styleTag.findMany({ orderBy: { sortOrder: 'asc' } }),
    getCurrencyConfig(),
  ]);

  const ratesByRole = new Map<string, typeof crewRates>();
  for (const rate of crewRates) {
    const list = ratesByRole.get(rate.roleSlug) ?? [];
    list.push(rate);
    ratesByRole.set(rate.roleSlug, list);
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-strong">{t('settingsTitle')}</h1>

      <Card title={t('settingsTitle')} subtitle={t('settingsHint')}>
        <form action={savePlatformSettingsForm}>
          <div className="grid gap-x-4 sm:grid-cols-3">
            <Field label={t('defaultCity')}>
              <Input name="defaultCity" defaultValue={settings.defaultCity} />
            </Field>
            <Field label={t('contingencyPct')}>
              <Input name="contingencyPct" type="number" min={0} max={80} dir="ltr" defaultValue={settings.contingencyPct} />
            </Field>
            <Field label={t('weeklyDiscountPct')}>
              <Input
                name="weeklyRentalDiscountPct"
                type="number"
                min={0}
                max={80}
                dir="ltr"
                defaultValue={settings.weeklyRentalDiscountPct}
              />
            </Field>
          </div>

          <div className="grid gap-x-4 sm:grid-cols-3">
            <Field label={t('dopMatchMinScore')}>
              <Input
                name="dopMatchMinScore"
                type="number"
                step="0.01"
                min={0}
                max={1}
                dir="ltr"
                defaultValue={settings.dopMatchMinScore}
              />
            </Field>
            <Field label={t('dopMatchCount')}>
              <Input name="dopMatchCount" type="number" min={1} max={12} dir="ltr" defaultValue={settings.dopMatchCount} />
            </Field>
            <Field label={t('shootDayHours')}>
              <Input name="shootDayHours" type="number" min={4} max={18} dir="ltr" defaultValue={settings.shootDayHours} />
            </Field>
          </div>

          <h3 className="mb-3 mt-2 text-sm font-semibold text-strong">{t('budgetTiers')}</h3>
          <div className="space-y-3">
            {tiers.map((tier) => (
              <div key={tier.tier} className="rounded-lg border border-line bg-surface-sunken p-3">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-accent">
                  {tEnum(`tier.${tier.tier}`)}
                </p>
                <div className="grid gap-x-4 sm:grid-cols-2 lg:grid-cols-4">
                  <Field label={t('min')}>
                    <Input name={`tier_${tier.tier}_min`} type="number" min={0} dir="ltr" defaultValue={tier.minTotal} />
                  </Field>
                  <Field label={t('max')}>
                    <Input name={`tier_${tier.tier}_max`} type="number" min={0} dir="ltr" defaultValue={tier.maxTotal} />
                  </Field>
                  <Field label={t('labelEn')}>
                    <Input name={`tier_${tier.tier}_labelEn`} defaultValue={tier.labelEn} />
                  </Field>
                  <Field label={t('labelAr')}>
                    <Input name={`tier_${tier.tier}_labelAr`} dir="rtl" defaultValue={tier.labelAr} />
                  </Field>
                </div>
              </div>
            ))}
          </div>

          <button type="submit" className="btn-primary text-xs">
            {t('save')}
          </button>
        </form>
      </Card>

      <Card title={t('currencies')} subtitle={t('currenciesHint')}>
        <CurrencyManager initial={currencies} />
      </Card>

      <Card title={t('crewRates')} subtitle={t('crewRatesHint')}>
        <div className="table-wrap">
          <table className="grid-table [--grid-cols:minmax(10rem,1.4fr)_repeat(3,minmax(10rem,1fr))]">
            <thead>
              <tr>
                <th>{t('role')}</th>
                {Object.values(BudgetTier).map((tier) => (
                  <th key={tier} className="text-end">
                    {tEnum(`tier.${tier}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...ratesByRole.entries()].map(([roleSlug, rates]) => (
                <tr key={roleSlug}>
                  <td data-label={t('role')} className="text-strong">
                    {locale === 'ar' ? rates[0].labelAr : rates[0].labelEn}
                    <span className="ms-2 text-[11px] text-muted">{roleSlug}</span>
                  </td>
                  {Object.values(BudgetTier).map((tier) => {
                    const rate = rates.find((r) => r.budgetTier === tier);
                    if (!rate) return <td key={tier} data-label={tEnum(`tier.${tier}`)} className="text-end">—</td>;
                    return (
                      <td key={tier} data-label={tEnum(`tier.${tier}`)} className="text-end">
                        <form action={saveCrewRateForm} className="flex items-center justify-end gap-1.5">
                          <input type="hidden" name="roleSlug" value={roleSlug} />
                          <input type="hidden" name="budgetTier" value={tier} />
                          <input
                            className="input w-24 py-1 text-end text-xs tabular-nums"
                            name="dayRate"
                            aria-label={t('dayRateField')}
                            title={t('dayRateField')}
                            type="number"
                            min={0}
                            dir="ltr"
                            defaultValue={rate.dayRate}
                          />
                          <input
                            className="input w-14 py-1 text-end text-xs tabular-nums"
                            name="headcount"
                            aria-label={t('headcountField')}
                            title={t('headcountField')}
                            type="number"
                            min={1}
                            dir="ltr"
                            defaultValue={rate.headcount}
                          />
                          <button type="submit" className="btn-ghost px-2 py-1 text-[11px]">
                            ✓
                          </button>
                        </form>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title={t('styleTags')} subtitle={t('styleTagsHint')}>
        <form action={saveStyleTagForm} className="mb-5 grid items-end gap-x-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label={t('labelEn')}>
            <Input name="labelEn" required />
          </Field>
          <Field label={t('labelAr')}>
            <Input name="labelAr" required dir="rtl" />
          </Field>
          <div className="mb-4">
            <button type="submit" className="btn-secondary text-xs">
              {t('addStyleTag')}
            </button>
          </div>
        </form>

        <StyleTagToggles
          locale={locale}
          tags={styleTags.map((tag) => ({
            slug: tag.slug,
            labelEn: tag.labelEn,
            labelAr: tag.labelAr,
            active: tag.active,
          }))}
        />
      </Card>
    </div>
  );
}

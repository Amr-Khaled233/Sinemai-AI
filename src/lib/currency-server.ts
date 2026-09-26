import 'server-only';
import { cache } from 'react';
import { cookies } from 'next/headers';
import { prisma } from '@/lib/prisma';
import { formatMoney } from '@/lib/utils';
import {
  BASE_CURRENCY,
  CURRENCY_COOKIE,
  DEFAULT_CURRENCY_CONFIG,
  availableCurrencies,
  convert,
  fxFor,
  resolveCurrency,
  type CurrencyConfig,
  type Fx,
} from '@/lib/currency';

const SETTINGS_KEY = 'currencies';

/** The admin's rates, once per request. */
export const getCurrencyConfig = cache(async (): Promise<CurrencyConfig> => {
  const row = await prisma.setting.findUnique({ where: { key: SETTINGS_KEY } }).catch(() => null);
  if (!row) return DEFAULT_CURRENCY_CONFIG;
  const value = row.value as Partial<CurrencyConfig>;
  return {
    defaultCode: value.defaultCode ?? DEFAULT_CURRENCY_CONFIG.defaultCode,
    rates: Array.isArray(value.rates) ? value.rates : DEFAULT_CURRENCY_CONFIG.rates,
  };
});

export async function saveCurrencyConfig(config: CurrencyConfig) {
  await prisma.setting.upsert({
    where: { key: SETTINGS_KEY },
    create: { key: SETTINGS_KEY, value: config },
    update: { value: config },
  });
}

/** What this viewer sees prices in, and what they could switch to. */
export const getDisplayCurrency = cache(async () => {
  const config = await getCurrencyConfig();
  const requested = (await cookies()).get(CURRENCY_COOKIE)?.value;
  return { code: resolveCurrency(config, requested), options: availableCurrencies(config), config };
});

/** The conversion from a stored currency (SAR unless stated) to the viewer's. */
export async function displayFx(from: string = BASE_CURRENCY): Promise<Fx> {
  const { code, config } = await getDisplayCurrency();
  return fxFor(config, from, code);
}

/**
 * A formatter for pages that print single amounts: converts from the stored
 * currency to the viewer's and formats in one step.
 */
export async function moneyFormatter(locale: string) {
  const { code, config } = await getDisplayCurrency();
  return (amount: number, from: string = BASE_CURRENCY) => {
    const fx = fxFor(config, from, code);
    return formatMoney(convert(amount, fx), locale, fx.code);
  };
}

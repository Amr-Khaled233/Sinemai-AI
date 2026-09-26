'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/routing';
import { saveCurrencies } from '@/app/actions/admin';
import { BASE_CURRENCY, isCurrencyCode, type CurrencyConfig, type CurrencyRate } from '@/lib/currency';
import { Select, Spinner } from '@/components/ui';

/**
 * The admin's exchange rates. Each rate says how many units of a currency one
 * SAR buys; every stored amount stays in SAR and is converted on display.
 */
export function CurrencyManager({ initial }: { initial: CurrencyConfig }) {
  const t = useTranslations('admin');
  const router = useRouter();
  const [rates, setRates] = useState<CurrencyRate[]>(initial.rates);
  const [defaultCode, setDefaultCode] = useState(initial.defaultCode);
  const [newCode, setNewCode] = useState('');
  const [newRate, setNewRate] = useState('');
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  const update = (code: string, patch: Partial<CurrencyRate>) =>
    setRates((current) => current.map((rate) => (rate.code === code ? { ...rate, ...patch } : rate)));

  const code = newCode.trim().toUpperCase();
  const rateValue = Number(newRate);
  const canAdd =
    isCurrencyCode(code) && code !== BASE_CURRENCY && !rates.some((r) => r.code === code) && rateValue > 0;

  const offered = [BASE_CURRENCY, ...rates.filter((r) => r.enabled).map((r) => r.code)];

  async function save() {
    setStatus('saving');
    const result = await saveCurrencies({ defaultCode, rates });
    setStatus(result.ok ? 'saved' : 'error');
    if (result.ok) router.refresh();
  }

  return (
    <div className="space-y-5">
      <div className="max-w-xs">
        <label className="label" htmlFor="currency-default">
          {t('defaultCurrency')}
        </label>
        <Select id="currency-default" value={defaultCode} onChange={(event) => setDefaultCode(event.target.value)}>
          {offered.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </Select>
      </div>

      <div className="table-wrap">
        <table className="grid-table grid-table-compact [--grid-cols:6rem_minmax(12rem,1fr)_6rem_6rem]">
          <thead>
            <tr>
              <th>{t('currencyCode')}</th>
              <th>{t('currencyRate', { base: BASE_CURRENCY })}</th>
              <th>{t('currencyShown')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            <tr>
              <td data-label={t('currencyCode')} className="font-medium text-strong">
                {BASE_CURRENCY}
              </td>
              <td data-label={t('currencyRate', { base: BASE_CURRENCY })} className="text-muted">
                {t('currencyBase')}
              </td>
              <td data-label={t('currencyShown')} className="text-muted">
                ✓
              </td>
              <td />
            </tr>
            {rates.map((rate) => (
              <tr key={rate.code}>
                <td data-label={t('currencyCode')} className="font-medium text-strong">
                  {rate.code}
                </td>
                <td data-label={t('currencyRate', { base: BASE_CURRENCY })}>
                  <input
                    className="input max-w-[10rem] py-1.5 tabular-nums"
                    type="number"
                    step="any"
                    min={0}
                    dir="ltr"
                    aria-label={t('currencyRate', { base: BASE_CURRENCY })}
                    value={rate.perBase}
                    onChange={(event) => update(rate.code, { perBase: Number(event.target.value) })}
                  />
                </td>
                <td data-label={t('currencyShown')}>
                  <input
                    type="checkbox"
                    className="size-4 accent-[rgb(var(--accent-soft))]"
                    aria-label={t('currencyShown')}
                    checked={rate.enabled}
                    onChange={(event) => update(rate.code, { enabled: event.target.checked })}
                  />
                </td>
                <td className="text-end">
                  <button
                    type="button"
                    className="btn-ghost px-2 text-xs text-danger"
                    onClick={() => setRates((current) => current.filter((r) => r.code !== rate.code))}
                  >
                    {t('delete')}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="label" htmlFor="currency-new-code">
            {t('currencyCode')}
          </label>
          <input
            id="currency-new-code"
            className="input w-28 uppercase"
            maxLength={3}
            dir="ltr"
            placeholder="EUR"
            value={newCode}
            onChange={(event) => setNewCode(event.target.value)}
          />
        </div>
        <div>
          <label className="label" htmlFor="currency-new-rate">
            {t('currencyRate', { base: BASE_CURRENCY })}
          </label>
          <input
            id="currency-new-rate"
            className="input w-40 tabular-nums"
            type="number"
            step="any"
            min={0}
            dir="ltr"
            placeholder="0.25"
            value={newRate}
            onChange={(event) => setNewRate(event.target.value)}
          />
        </div>
        <button
          type="button"
          className="btn-secondary text-xs"
          disabled={!canAdd}
          onClick={() => {
            setRates((current) => [...current, { code, perBase: rateValue, enabled: true }]);
            setNewCode('');
            setNewRate('');
          }}
        >
          {t('addCurrency')}
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t border-line pt-5">
        <button type="button" className="btn-primary text-xs" disabled={status === 'saving'} onClick={save}>
          {status === 'saving' && <Spinner />}
          {t('save')}
        </button>
        {status === 'saved' && <span className="text-xs text-success">{t('saved')}</span>}
        {status === 'error' && <span className="text-xs text-danger">{t('saveFailed')}</span>}
      </div>
    </div>
  );
}

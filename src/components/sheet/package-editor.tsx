'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/routing';
import { updateEquipmentPackage, type PackageEdit } from '@/app/actions/package';
import { Select, Spinner } from '@/components/ui';
import { cn } from '@/lib/utils';
import type { PackageItem } from '@/agents/types';

export type CatalogOption = {
  id: string;
  label: string;
  categorySlug: string;
};

/**
 * Lets a producer adjust the recommended package and re-price it.
 *
 * Nothing here calls a model: the script has not changed, so there is nothing
 * to re-reason about. Saving re-queries vendor stock and runs the same pricing
 * the agent used, which is instant and costs nothing.
 */
export function PackageEditor({
  projectId,
  items,
  catalog,
  categoryLabel,
}: {
  projectId: string;
  items: PackageItem[];
  catalog: CatalogOption[];
  /** Localised category names, keyed by slug. */
  categoryLabel: Record<string, string>;
}) {
  const t = useTranslations('sheet');
  const tc = useTranslations('common');
  const router = useRouter();

  const [draft, setDraft] = useState<PackageItem[]>(items);
  const [adding, setAdding] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty = useMemo(() => {
    if (draft.length !== items.length) return true;
    return draft.some((line, index) => {
      const original = items[index];
      return (
        !original ||
        line.equipmentId !== original.equipmentId ||
        line.quantity !== original.quantity ||
        line.rentalDays !== original.rentalDays
      );
    });
  }, [draft, items]);

  const chosen = new Set(draft.map((line) => line.equipmentId));
  const available = catalog.filter((option) => !chosen.has(option.id));

  function patch(equipmentId: string, changes: Partial<PackageItem>) {
    setDraft((current) =>
      current.map((line) => (line.equipmentId === equipmentId ? { ...line, ...changes } : line)),
    );
  }

  async function save() {
    setPending(true);
    setError(null);
    const payload: PackageEdit[] = draft.map((line) => ({
      equipmentId: line.equipmentId,
      quantity: line.quantity,
      rentalDays: line.rentalDays,
    }));

    const result = await updateEquipmentPackage(projectId, payload);
    setPending(false);
    if (result.ok) router.refresh();
    else setError(result.error === 'PACKAGE_EMPTY' ? t('packageEmpty') : tc('error'));
  }

  return (
    <div>
      <div className="table-wrap">
        <table className="grid-table [--grid-cols:7rem_minmax(10rem,1.5fr)_5.5rem_5.5rem_minmax(8rem,1.6fr)_3rem]">
          <thead>
            <tr>
              <th>{t('category')}</th>
              <th>{t('item')}</th>
              <th className="text-end">{t('quantity')}</th>
              <th className="text-end">{t('days')}</th>
              <th>{t('reason')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {draft.map((line) => (
              <tr key={line.equipmentId}>
                <td
                  data-label={t('category')}
                  className="text-xs uppercase tracking-wider text-accent"
                >
                  {categoryLabel[line.categorySlug] ?? line.categorySlug}
                </td>
                <td data-label={t('item')} className="font-medium text-strong">
                  {line.brand} {line.model}
                </td>
                <td data-label={t('quantity')} className="text-end">
                  <input
                    type="number"
                    min={1}
                    max={20}
                    dir="ltr"
                    aria-label={t('quantity')}
                    className="input w-20 py-1.5 text-end text-sm tabular-nums"
                    value={line.quantity}
                    onChange={(event) =>
                      patch(line.equipmentId, { quantity: Math.max(1, Number(event.target.value) || 1) })
                    }
                  />
                </td>
                <td data-label={t('days')} className="text-end">
                  <input
                    type="number"
                    min={1}
                    max={180}
                    dir="ltr"
                    aria-label={t('days')}
                    className="input w-20 py-1.5 text-end text-sm tabular-nums"
                    value={line.rentalDays}
                    onChange={(event) =>
                      patch(line.equipmentId, { rentalDays: Math.max(1, Number(event.target.value) || 1) })
                    }
                  />
                </td>
                <td data-label={t('reason')} className="text-muted">
                  {line.reason}
                </td>
                <td>
                  <button
                    type="button"
                    aria-label={t('removeItem')}
                    title={t('removeItem')}
                    className="btn-ghost px-2 text-danger"
                    onClick={() =>
                      setDraft((current) => current.filter((row) => row.equipmentId !== line.equipmentId))
                    }
                  >
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <Select
          aria-label={t('addItem')}
          className="sm:max-w-sm"
          value={adding}
          onChange={(event) => {
            const option = catalog.find((row) => row.id === event.target.value);
            if (!option) return;
            setDraft((current) => [
              ...current,
              {
                equipmentId: option.id,
                categorySlug: option.categorySlug,
                brand: option.label.split(' ')[0] ?? option.label,
                model: option.label.split(' ').slice(1).join(' ') || option.label,
                quantity: 1,
                rentalDays: current[0]?.rentalDays ?? 1,
                reason: t('addedByYou'),
              },
            ]);
            setAdding('');
          }}
        >
          <option value="">{t('addItem')}</option>
          {available.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </Select>

        <div className={cn('flex items-center gap-3 sm:ms-auto', !dirty && 'opacity-60')}>
          {dirty && (
            <button
              type="button"
              className="btn-ghost text-xs"
              onClick={() => {
                setDraft(items);
                setError(null);
              }}
            >
              {tc('cancel')}
            </button>
          )}
          <button type="button" className="btn-primary text-xs" disabled={!dirty || pending} onClick={save}>
            {pending && <Spinner className="size-3.5" />}
            {t('saveAndReprice')}
          </button>
        </div>
      </div>

      {error && <p className="mt-3 text-xs text-danger">{error}</p>}
      {dirty && !error && <p className="mt-3 text-xs text-muted">{t('repriceHint')}</p>}
    </div>
  );
}

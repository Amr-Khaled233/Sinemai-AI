'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/routing';
import {
  addAvailabilityBlock,
  deleteInventoryItem,
  removeAvailabilityBlock,
  saveInventoryItem,
  toggleInventoryActive,
} from '@/app/actions/vendor';
import { Badge, Card, Field, Input, Select, Textarea } from '@/components/ui';

export type CatalogOption = {
  id: string;
  label: string;
  categorySlug: string;
  indicativeDayRate: number | null;
};

export type InventoryRow = {
  id: string;
  equipmentId: string;
  label: string;
  dailyRate: number;
  weeklyRate: number | null;
  monthlyRate: number | null;
  quantityTotal: number;
  quantityAvailable: number;
  city: string;
  notes: string | null;
  active: boolean;
  blocks: Array<{ id: string; startDate: string; endDate: string; quantity: number; reason: string | null }>;
};

export function InventoryManager({
  catalog,
  items,
  defaultCity,
}: {
  catalog: CatalogOption[];
  items: InventoryRow[];
  defaultCity: string;
}) {
  const t = useTranslations('vendor');
  const tc = useTranslations('common');
  const router = useRouter();
  const [editing, setEditing] = useState<InventoryRow | null>(null);
  const [adding, setAdding] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const used = useMemo(() => new Set(items.map((item) => item.equipmentId)), [items]);
  const available = catalog.filter((option) => !used.has(option.id) || editing?.equipmentId === option.id);

  async function submit(formData: FormData) {
    setPending(true);
    setError(null);
    const result = await saveInventoryItem(formData);
    setPending(false);
    if (result.ok) {
      setEditing(null);
      setAdding(false);
      router.refresh();
    } else {
      setError(result.error);
    }
  }

  const showForm = adding || editing !== null;

  return (
    <div className="space-y-6">
      <Card
        title={t('inventoryTitle')}
        subtitle={`${items.length} item(s)`}
        action={
          !showForm && (
            <button type="button" className="btn-primary text-xs" onClick={() => setAdding(true)}>
              {t('addItem')}
            </button>
          )
        }
      >
        {showForm && (
          <form action={submit} className="mb-6 rounded-xl border border-accent/40 bg-surface-sunken p-4">
            {editing && <input type="hidden" name="id" value={editing.id} />}

            <Field label={t('equipment')}>
              <Select name="equipmentId" required defaultValue={editing?.equipmentId ?? ''}>
                <option value="" disabled>
                  —
                </option>
                {available.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                    {option.indicativeDayRate ? ` · ~${option.indicativeDayRate} SAR/day` : ''}
                  </option>
                ))}
              </Select>
            </Field>

            <div className="grid gap-x-4 sm:grid-cols-3">
              <Field label={t('dailyRate')}>
                <Input
                  name="dailyRate"
                  type="number"
                  min={1}
                  required
                  dir="ltr"
                  defaultValue={editing?.dailyRate}
                />
              </Field>
              <Field label={`${t('weeklyRate')} (${tc('optional')})`}>
                <Input name="weeklyRate" type="number" min={0} dir="ltr" defaultValue={editing?.weeklyRate ?? ''} />
              </Field>
              <Field label={`${t('monthlyRate')} (${tc('optional')})`}>
                <Input name="monthlyRate" type="number" min={0} dir="ltr" defaultValue={editing?.monthlyRate ?? ''} />
              </Field>
            </div>

            <div className="grid gap-x-4 sm:grid-cols-3">
              <Field label={t('quantity')}>
                <Input
                  name="quantityTotal"
                  type="number"
                  min={1}
                  required
                  dir="ltr"
                  defaultValue={editing?.quantityTotal ?? 1}
                />
              </Field>
              <Field label={t('availability')}>
                <Input
                  name="quantityAvailable"
                  type="number"
                  min={0}
                  required
                  dir="ltr"
                  defaultValue={editing?.quantityAvailable ?? 1}
                />
              </Field>
              <Field label={t('city')}>
                <Input name="city" required defaultValue={editing?.city ?? defaultCity} />
              </Field>
            </div>

            <Field label={`${t('notes')} (${tc('optional')})`}>
              <Textarea name="notes" rows={2} defaultValue={editing?.notes ?? ''} />
            </Field>

            <Field label={`${t('photos')} (${tc('optional')})`}>
              <Input
                type="file"
                name="photo"
                accept="image/*"
                className="file:me-3 file:rounded-md file:border-0 file:bg-accent/20 file:px-3 file:py-1.5 file:text-xs file:text-accent"
              />
            </Field>

            {error && <p className="mb-3 text-xs text-danger">{error}</p>}

            <div className="flex gap-2">
              <button type="submit" className="btn-primary text-xs" disabled={pending}>
                {pending ? tc('loading') : t('save')}
              </button>
              <button
                type="button"
                className="btn-ghost text-xs"
                onClick={() => {
                  setAdding(false);
                  setEditing(null);
                  setError(null);
                }}
              >
                {tc('cancel')}
              </button>
            </div>
          </form>
        )}

        {items.length === 0 ? (
          <p className="prose-sheet">{t('empty')}</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>{t('equipment')}</th>
                  <th className="text-end">{t('dailyRate')}</th>
                  <th className="text-end">{t('weeklyRate')}</th>
                  <th className="text-end">{t('quantity')}</th>
                  <th>{t('city')}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id} className={item.active ? '' : 'opacity-50'}>
                    <td className="font-medium text-strong">
                      {item.label}
                      {item.blocks.length > 0 && (
                        <button
                          type="button"
                          className="ms-2 text-[11px] text-warning hover:underline"
                          onClick={() => setExpanded(expanded === item.id ? null : item.id)}
                        >
                          {item.blocks.length} {t('blocks')}
                        </button>
                      )}
                      {expanded === item.id && (
                        <ul className="mt-2 space-y-1">
                          {item.blocks.map((block) => (
                            <li key={block.id} className="flex items-center gap-2 text-[11px] text-muted">
                              <span dir="ltr">
                                {block.startDate} → {block.endDate}
                              </span>
                              <span>×{block.quantity}</span>
                              {block.reason && <span>· {block.reason}</span>}
                              <button
                                type="button"
                                className="text-danger hover:underline"
                                onClick={async () => {
                                  await removeAvailabilityBlock(block.id);
                                  router.refresh();
                                }}
                              >
                                ×
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </td>
                    <td className="text-end tabular-nums">{item.dailyRate}</td>
                    <td className="text-end tabular-nums">{item.weeklyRate ?? '—'}</td>
                    <td className="text-end tabular-nums">
                      {item.quantityAvailable}/{item.quantityTotal}
                    </td>
                    <td>{item.city}</td>
                    <td>
                      <div className="flex flex-wrap justify-end gap-1.5">
                        <button type="button" className="btn-ghost text-[11px]" onClick={() => setEditing(item)}>
                          {tc('save')}
                        </button>
                        <button
                          type="button"
                          className="btn-ghost text-[11px]"
                          onClick={async () => {
                            await toggleInventoryActive(item.id, !item.active);
                            router.refresh();
                          }}
                        >
                          {item.active ? <Badge tone="green">on</Badge> : <Badge>off</Badge>}
                        </button>
                        <button
                          type="button"
                          className="btn-ghost text-[11px] text-danger"
                          onClick={async () => {
                            await deleteInventoryItem(item.id);
                            router.refresh();
                          }}
                        >
                          {t('delete')}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {items.length > 0 && (
        <Card title={t('blockDates')} subtitle={t('availability')}>
          <form
            action={async (formData) => {
              setPending(true);
              const result = await addAvailabilityBlock(formData);
              setPending(false);
              if (result.ok) router.refresh();
              else setError(result.error);
            }}
            className="grid items-end gap-x-4 sm:grid-cols-5"
          >
            <Field label={t('equipment')} className="sm:col-span-2">
              <Select name="itemId" required>
                {items.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('from')}>
              <Input type="date" name="startDate" required dir="ltr" />
            </Field>
            <Field label={t('to')}>
              <Input type="date" name="endDate" required dir="ltr" />
            </Field>
            <Field label={t('quantity')}>
              <Input type="number" name="quantity" min={1} defaultValue={1} dir="ltr" />
            </Field>
            <Field label={`${t('reason')} (${tc('optional')})`} className="sm:col-span-4">
              <Input name="reason" />
            </Field>
            <div className="mb-4">
              <button type="submit" className="btn-secondary text-xs" disabled={pending}>
                {t('addBlock')}
              </button>
            </div>
          </form>
        </Card>
      )}
    </div>
  );
}

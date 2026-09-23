'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/routing';
import { deleteEquipment, saveEquipment } from '@/app/actions/admin';
import { Badge, Card, Field, Input, Select, Textarea } from '@/components/ui';

const COMPLEXITIES = ['LOW', 'MEDIUM', 'HIGH'] as const;
const MOVEMENTS = ['STATIC', 'HANDHELD', 'STEADICAM_GIMBAL', 'CRANE_DOLLY', 'DRONE'] as const;
const TIERS = ['LOW', 'MEDIUM', 'HIGH'] as const;
const DAY_NIGHT = ['BOTH', 'DAY', 'NIGHT'] as const;

export type EquipmentRow = {
  id: string;
  categoryId: string;
  categorySlug: string;
  brand: string;
  model: string;
  nameAr: string | null;
  specs: unknown;
  summaryEn: string;
  summaryAr: string;
  lighting: string[];
  movement: string[];
  tiers: string[];
  dayNight: string;
  capabilities: string[];
  indicativeDayRate: number | null;
  isCore: boolean;
  active: boolean;
  vendorCount: number;
};

export function EquipmentManager({
  rows,
  categories,
}: {
  rows: EquipmentRow[];
  categories: Array<{ id: string; slug: string; nameEn: string }>;
}) {
  const t = useTranslations('admin');
  const tEnum = useTranslations('enum');
  const tc = useTranslations('common');
  const router = useRouter();
  const [editing, setEditing] = useState<EquipmentRow | null>(null);
  const [adding, setAdding] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  const showForm = adding || editing !== null;
  const filtered = rows.filter((row) =>
    `${row.brand} ${row.model} ${row.categorySlug}`.toLowerCase().includes(query.toLowerCase()),
  );

  async function submit(formData: FormData) {
    setPending(true);
    setError(null);
    const result = await saveEquipment(formData);
    setPending(false);
    if (result.ok) {
      setAdding(false);
      setEditing(null);
      router.refresh();
    } else {
      setError(result.error);
    }
  }

  return (
    <Card
      title={t('equipmentTitle')}
      subtitle={`${rows.length} item(s)`}
      action={
        !showForm && (
          <button type="button" className="btn-primary text-xs" onClick={() => setAdding(true)}>
            {t('addEquipment')}
          </button>
        )
      }
    >
      {showForm && (
        <form action={submit} className="mb-6 rounded-xl border border-brass-600/40 bg-ink-900/60 p-4">
          {editing && <input type="hidden" name="id" value={editing.id} />}

          <div className="grid gap-x-4 sm:grid-cols-3">
            <Field label={t('category')}>
              <Select name="categoryId" required defaultValue={editing?.categoryId ?? categories[0]?.id}>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.nameEn}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t('brand')}>
              <Input name="brand" required defaultValue={editing?.brand} />
            </Field>
            <Field label={t('model')}>
              <Input name="model" required defaultValue={editing?.model} />
            </Field>
          </div>

          <div className="grid gap-x-4 sm:grid-cols-2">
            <Field label={`${t('model')} (Arabic)`}>
              <Input name="nameAr" defaultValue={editing?.nameAr ?? ''} dir="rtl" />
            </Field>
            <Field label={t('indicativeRate')}>
              <Input
                name="indicativeDayRate"
                type="number"
                min={0}
                dir="ltr"
                defaultValue={editing?.indicativeDayRate ?? ''}
              />
            </Field>
          </div>

          <div className="grid gap-x-4 sm:grid-cols-3">
            <Field label={t('tiers')}>
              <CheckGroup name="tiers" values={TIERS} selected={editing?.tiers ?? ['MEDIUM']} labeller={(v) => tEnum(`tier.${v}`)} />
            </Field>
            <Field label={t('lightingSuitability')}>
              <CheckGroup
                name="lighting"
                values={COMPLEXITIES}
                selected={editing?.lighting ?? ['MEDIUM']}
                labeller={(v) => tEnum(`complexity.${v}`)}
              />
            </Field>
            <Field label={t('dayNight')}>
              <Select name="dayNight" defaultValue={editing?.dayNight ?? 'BOTH'}>
                {DAY_NIGHT.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <Field label={t('movementSuitability')}>
            <CheckGroup
              name="movement"
              values={MOVEMENTS}
              selected={editing?.movement ?? ['STATIC', 'HANDHELD']}
              labeller={(v) => tEnum(`movement.${v}`)}
            />
          </Field>

          <Field label={t('capabilities')} hint="Comma separated, matched against scene special requirements.">
            <Input name="capabilities" defaultValue={(editing?.capabilities ?? []).join(', ')} />
          </Field>

          <div className="grid gap-x-4 sm:grid-cols-2">
            <Field label={t('summaryEn')}>
              <Textarea name="summaryEn" rows={2} defaultValue={editing?.summaryEn ?? ''} />
            </Field>
            <Field label={t('summaryAr')}>
              <Textarea name="summaryAr" rows={2} dir="rtl" defaultValue={editing?.summaryAr ?? ''} />
            </Field>
          </div>

          <Field label={t('specs')} hint='e.g. {"sensor":"Super 35","dynamicRange":"17 stops"}'>
            <Textarea
              name="specs"
              rows={4}
              dir="ltr"
              defaultValue={JSON.stringify(editing?.specs ?? {}, null, 2)}
            />
          </Field>

          <div className="mb-4 flex flex-wrap gap-4 text-xs text-[rgb(var(--muted))]">
            <label className="flex items-center gap-2">
              <input type="checkbox" name="isCore" defaultChecked={editing?.isCore ?? false} />
              {t('isCore')}
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" name="active" defaultChecked={editing?.active ?? true} />
              {t('active')}
            </label>
          </div>

          {error && <p className="mb-3 text-xs text-red-400">{error}</p>}

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

      <div className="mb-4">
        <Input placeholder={tc('search')} value={query} onChange={(event) => setQuery(event.target.value)} />
      </div>

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>{t('category')}</th>
              <th>{t('brand')}</th>
              <th>{t('model')}</th>
              <th>{t('tiers')}</th>
              <th>{t('lightingSuitability')}</th>
              <th className="text-end">{t('indicativeRate')}</th>
              <th className="text-end">Vendors</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {filtered.map((row) => (
              <tr key={row.id} className={row.active ? '' : 'opacity-50'}>
                <td className="text-xs uppercase tracking-wider text-brass-500">{row.categorySlug}</td>
                <td className="text-white">{row.brand}</td>
                <td>
                  {row.model}
                  {row.isCore && <Badge className="ms-2">core</Badge>}
                </td>
                <td className="text-xs">{row.tiers.join('/')}</td>
                <td className="text-xs">{row.lighting.join('/')}</td>
                <td className="text-end tabular-nums">{row.indicativeDayRate ?? '—'}</td>
                <td className="text-end tabular-nums">{row.vendorCount}</td>
                <td>
                  <div className="flex justify-end gap-1.5">
                    <button type="button" className="btn-ghost text-[11px]" onClick={() => setEditing(row)}>
                      {t('save')}
                    </button>
                    <button
                      type="button"
                      className="btn-ghost text-[11px] text-red-400"
                      onClick={async () => {
                        await deleteEquipment(row.id);
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
    </Card>
  );
}

function CheckGroup({
  name,
  values,
  selected,
  labeller,
}: {
  name: string;
  values: readonly string[];
  selected: string[];
  labeller: (value: string) => string;
}) {
  return (
    <div className="flex flex-wrap gap-2 pt-1">
      {values.map((value) => (
        <label key={value} className="chip cursor-pointer text-[11px]">
          <input type="checkbox" name={name} value={value} defaultChecked={selected.includes(value)} />
          {labeller(value)}
        </label>
      ))}
    </div>
  );
}

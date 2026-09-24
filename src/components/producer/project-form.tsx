'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { createProject } from '@/app/actions/projects';
import { Field, Input, Select, Textarea } from '@/components/ui';
import { StyleTagPicker, type StyleTag } from '@/components/style-tag-picker';

const TYPES = ['COMMERCIAL', 'SHORT_FILM', 'SERIES', 'FEATURE', 'DOCUMENTARY'] as const;
const TIERS = ['LOW', 'MEDIUM', 'HIGH'] as const;

export function ProjectForm({
  locale,
  tags,
  tierLabels,
  defaultCity,
}: {
  locale: string;
  tags: StyleTag[];
  tierLabels: Record<string, string>;
  defaultCity: string;
}) {
  const t = useTranslations('project');
  const tEnum = useTranslations('enum');
  const [selected, setSelected] = useState<string[]>([]);
  const [pending, setPending] = useState(false);

  return (
    <form
      action={async (formData) => {
        setPending(true);
        await createProject(locale, formData);
        setPending(false);
      }}
    >
      <Field label={t('name')}>
        <Input name="name" required maxLength={160} />
      </Field>

      <div className="grid gap-x-4 sm:grid-cols-2">
        <Field label={t('type')}>
          <Select name="type" defaultValue="COMMERCIAL">
            {TYPES.map((type) => (
              <option key={type} value={type}>
                {tEnum(`type.${type}`)}
              </option>
            ))}
          </Select>
        </Field>

        <Field label={t('budgetTier')}>
          <Select name="budgetTier" defaultValue="MEDIUM">
            {TIERS.map((tier) => (
              <option key={tier} value={tier}>
                {tierLabels[tier]}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <div className="grid gap-x-4 sm:grid-cols-3">
        <Field label={t('city')}>
          <Input name="city" required defaultValue={defaultCity} />
        </Field>
        <Field label={t('shootStart')}>
          <Input name="shootStartDate" type="date" dir="ltr" />
        </Field>
        <Field label={t('shootEnd')}>
          <Input name="shootEndDate" type="date" dir="ltr" />
        </Field>
      </div>

      <Field label={t('visualStyle')} hint={t('visualStyleHint')}>
        <StyleTagPicker tags={tags} locale={locale} selected={selected} onChange={setSelected} />
      </Field>

      <Field label={t('synopsis')}>
        <Textarea name="synopsis" maxLength={2000} rows={3} />
      </Field>

      <button type="submit" className="btn-primary" disabled={pending}>
        {t('create')}
      </button>
    </form>
  );
}

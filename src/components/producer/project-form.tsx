'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { createProject } from '@/app/actions/projects';
import { Field, Input, Select, Textarea } from '@/components/ui';

type StyleTag = { slug: string; labelEn: string; labelAr: string };

const TYPES = ['COMMERCIAL', 'SHORT_FILM', 'SERIES', 'FEATURE', 'DOCUMENTARY'] as const;
const TIERS = ['LOW', 'MEDIUM', 'HIGH'] as const;

export function StyleTagPicker({
  tags,
  locale,
  selected,
  onChange,
  name = 'visualStyleTags',
}: {
  tags: StyleTag[];
  locale: string;
  selected: string[];
  onChange: (next: string[]) => void;
  name?: string;
}) {
  const toggle = (slug: string) => {
    onChange(selected.includes(slug) ? selected.filter((s) => s !== slug) : [...selected, slug].slice(0, 8));
  };

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {tags.map((tag) => {
          const on = selected.includes(tag.slug);
          return (
            <button
              key={tag.slug}
              type="button"
              onClick={() => toggle(tag.slug)}
              className={`chip transition-colors ${on ? 'chip-on' : 'hover:border-accent/60'}`}
              aria-pressed={on}
            >
              {locale === 'ar' ? tag.labelAr : tag.labelEn}
            </button>
          );
        })}
      </div>
      {selected.map((slug) => (
        <input key={slug} type="hidden" name={name} value={slug} />
      ))}
    </>
  );
}

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

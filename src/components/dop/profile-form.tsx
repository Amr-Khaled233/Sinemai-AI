'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/routing';
import { saveDopProfile } from '@/app/actions/dop';
import { Field, Input, Textarea } from '@/components/ui';
import { StyleTagPicker } from '@/components/producer/project-form';

type StyleTag = { slug: string; labelEn: string; labelAr: string };

export function DopProfileForm({
  locale,
  tags,
  profile,
}: {
  locale: string;
  tags: StyleTag[];
  profile: {
    displayName: string;
    displayNameAr: string | null;
    bio: string;
    city: string | null;
    dayRate: number | null;
    yearsExperience: number | null;
    portfolioLinks: string[];
    styleTags: string[];
  };
}) {
  const t = useTranslations('dop');
  const tc = useTranslations('common');
  const router = useRouter();
  const [selected, setSelected] = useState<string[]>(profile.styleTags);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      action={async (formData) => {
        setPending(true);
        setError(null);
        setMessage(null);
        const result = await saveDopProfile(formData);
        setPending(false);
        if (result.ok) {
          setMessage(result.embedded ? t('saved') : `${t('saved')} ${t('embeddingPending')}`);
          router.refresh();
        } else {
          setError(result.error === 'UNAUTHORIZED' ? tc('unauthorized') : tc('error'));
        }
      }}
    >
      <div className="grid gap-x-4 sm:grid-cols-2">
        <Field label={t('displayName')}>
          <Input name="displayName" required defaultValue={profile.displayName} />
        </Field>
        <Field label={t('displayNameAr')}>
          <Input name="displayNameAr" defaultValue={profile.displayNameAr ?? ''} dir="rtl" />
        </Field>
      </div>

      <Field label={t('bio')} hint={t('bioHint')}>
        <Textarea name="bio" required minLength={40} rows={6} defaultValue={profile.bio} />
      </Field>

      <div className="grid gap-x-4 sm:grid-cols-3">
        <Field label={t('city')}>
          <Input name="city" defaultValue={profile.city ?? ''} />
        </Field>
        <Field label={t('dayRate')}>
          <Input name="dayRate" type="number" min={0} dir="ltr" defaultValue={profile.dayRate ?? ''} />
        </Field>
        <Field label={t('years')}>
          <Input
            name="yearsExperience"
            type="number"
            min={0}
            max={70}
            dir="ltr"
            defaultValue={profile.yearsExperience ?? ''}
          />
        </Field>
      </div>

      <Field label={t('portfolio')} hint={t('portfolioHint')}>
        <Textarea
          name="portfolioLinks"
          rows={3}
          dir="ltr"
          defaultValue={profile.portfolioLinks.join('\n')}
          placeholder={'https://vimeo.com/…\nhttps://www.imdb.com/name/…'}
        />
      </Field>

      <Field label={t('styleTags')}>
        <StyleTagPicker tags={tags} locale={locale} selected={selected} onChange={setSelected} name="styleTags" />
      </Field>

      {error && <p className="mb-3 text-xs text-red-400">{error}</p>}
      {message && <p className="mb-3 text-xs text-teal-400">{message}</p>}

      <button type="submit" className="btn-primary" disabled={pending || selected.length === 0}>
        {pending ? tc('loading') : t('save')}
      </button>
    </form>
  );
}

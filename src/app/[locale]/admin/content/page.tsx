import { getTranslations, setRequestLocale } from 'next-intl/server';
import { requireRole } from '@/lib/auth';
import { flattenMessages, type Messages } from '@/lib/site-copy';
import { getCopyOverrides } from '@/lib/site-copy-server';
import { Card } from '@/components/ui';
import { ContentEditor, type CopyRow } from '@/components/admin/content-editor';
import en from '../../../../../messages/en.json';
import ar from '../../../../../messages/ar.json';
import type { AppLocale } from '@/i18n/routing';

export default async function AdminContentPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale as AppLocale);
  await requireRole('ADMIN', locale);

  const [t, overrides] = await Promise.all([getTranslations('admin'), getCopyOverrides()]);

  const shippedEn = flattenMessages(en as Messages);
  const shippedAr = flattenMessages(ar as Messages);

  const rows: CopyRow[] = Object.keys(shippedEn).map((key) => {
    const original = { en: shippedEn[key], ar: shippedAr[key] ?? '' };
    const current = {
      en: overrides.en?.[key] ?? original.en,
      ar: overrides.ar?.[key] ?? original.ar,
    };
    return {
      key,
      original,
      current,
      edited: current.en !== original.en || current.ar !== original.ar,
    };
  });

  const namespaces = Object.keys(en);

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-strong">{t('contentTitle')}</h1>
      <Card subtitle={t('contentHint')}>
        <ContentEditor rows={rows} namespaces={namespaces} />
      </Card>
    </div>
  );
}

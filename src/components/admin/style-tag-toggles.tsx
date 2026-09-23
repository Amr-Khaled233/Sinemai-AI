'use client';

import { useState } from 'react';
import { useRouter } from '@/i18n/routing';
import { toggleStyleTag } from '@/app/actions/admin';

export function StyleTagToggles({
  tags,
  locale,
}: {
  tags: Array<{ slug: string; labelEn: string; labelAr: string; active: boolean }>;
  locale: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);

  return (
    <div className="flex flex-wrap gap-2">
      {tags.map((tag) => (
        <button
          key={tag.slug}
          type="button"
          disabled={pending === tag.slug}
          className={`chip ${tag.active ? 'chip-on' : 'opacity-50'}`}
          onClick={async () => {
            setPending(tag.slug);
            await toggleStyleTag(tag.slug, !tag.active);
            setPending(null);
            router.refresh();
          }}
        >
          {locale === 'ar' ? tag.labelAr : tag.labelEn}
        </button>
      ))}
    </div>
  );
}

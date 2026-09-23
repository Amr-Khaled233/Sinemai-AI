'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/routing';
import { saveScript } from '@/app/actions/projects';
import { Field, Input, Textarea } from '@/components/ui';

const ERRORS: Record<string, string> = {
  NO_SCRIPT: 'noScript',
  EMPTY_SCRIPT: 'noScript',
  NO_SCENES_FOUND: 'noScript',
};

export function ScriptUpload({
  projectId,
  hasScript,
}: {
  projectId: string;
  hasScript: boolean;
}) {
  const t = useTranslations('project');
  const tc = useTranslations('common');
  const router = useRouter();
  const [mode, setMode] = useState<'file' | 'paste'>('file');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      action={async (formData) => {
        setPending(true);
        setError(null);
        const result = await saveScript(projectId, formData);
        setPending(false);
        if (result.ok) {
          router.refresh();
        } else {
          setError(ERRORS[result.error] ? t(ERRORS[result.error]) : tc('error'));
        }
      }}
    >
      <div className="mb-4 flex gap-2">
        <button
          type="button"
          onClick={() => setMode('file')}
          className={`chip ${mode === 'file' ? 'chip-on' : ''}`}
        >
          {t('uploadFile')}
        </button>
        <button
          type="button"
          onClick={() => setMode('paste')}
          className={`chip ${mode === 'paste' ? 'chip-on' : ''}`}
        >
          {t('pasteInstead')}
        </button>
      </div>

      {mode === 'file' ? (
        <Field label={t('uploadFile')} hint={t('uploadHint')}>
          <Input
            type="file"
            name="file"
            accept=".fountain,.fdx,.pdf,.txt,.md,application/pdf,text/plain,text/xml,application/xml"
            className="file:me-3 file:rounded-md file:border-0 file:bg-accent/20 file:px-3 file:py-1.5 file:text-xs file:text-accent"
          />
        </Field>
      ) : (
        <Field label={t('pasteInstead')}>
          <Textarea name="pasted" rows={10} placeholder={t('pastePlaceholder')} />
        </Field>
      )}

      {error && <p className="mb-3 text-xs text-danger">{error}</p>}

      <button type="submit" className="btn-secondary" disabled={pending}>
        {pending ? tc('loading') : hasScript ? t('replaceScript') : t('saveScript')}
      </button>
    </form>
  );
}

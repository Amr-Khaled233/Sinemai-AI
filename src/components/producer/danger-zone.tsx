'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { deleteProject } from '@/app/actions/projects';
import { Spinner } from '@/components/ui';

/**
 * Deleting a project takes its script, scenes, sheet and agent trail with it,
 * so the confirmation asks for the project name rather than a yes/no — a
 * misplaced click cannot destroy work that took real money to produce.
 */
export function DeleteProjectButton({ projectId, projectName }: { projectId: string; projectName: string }) {
  const t = useTranslations('project');
  const tc = useTranslations('common');
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [pending, setPending] = useState(false);
  const openerRef = useRef<HTMLButtonElement | null>(null);

  const close = useCallback(() => {
    setOpen(false);
    setTyped('');
    openerRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    document.addEventListener('keydown', onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [open, close]);

  const confirmed = typed.trim() === projectName.trim();

  return (
    <>
      <button
        ref={openerRef}
        type="button"
        className="btn-danger text-xs"
        onClick={() => setOpen(true)}
      >
        {t('delete')}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex animate-fade-in items-end justify-center bg-page/70 backdrop-blur-sm sm:items-center sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-label={t('deleteTitle')}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) close();
          }}
        >
          <div className="card w-full max-w-md animate-scale-in rounded-b-none p-5 shadow-lift sm:rounded-lg">
            <h2 className="text-base font-semibold text-strong">{t('deleteTitle')}</h2>
            <p className="mt-2 text-sm leading-6 text-muted">{t('deleteWarning')}</p>

            <label className="label mt-5">{t('deleteConfirmLabel', { name: projectName })}</label>
            <input
              className="input"
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              placeholder={projectName}
              autoComplete="off"
            />

            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button type="button" className="btn-ghost text-xs" onClick={close}>
                {tc('cancel')}
              </button>
              <button
                type="button"
                className="btn-danger text-xs"
                disabled={!confirmed || pending}
                onClick={async () => {
                  setPending(true);
                  // The action redirects on success, so nothing runs after it.
                  await deleteProject(locale, projectId);
                  setPending(false);
                }}
              >
                {pending && <Spinner className="size-3.5" />}
                {t('deleteConfirm')}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

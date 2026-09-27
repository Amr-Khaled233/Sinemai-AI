'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { signOut } from 'next-auth/react';
import { Link, usePathname } from '@/i18n/routing';
import { NavLinks, type NavLink } from '@/components/nav-links';
import { LocaleSwitcher } from '@/components/locale-switcher';

/**
 * The header on a phone: one menu button that opens a panel under the bar
 * with everything the desktop header shows side by side — the pages, the
 * language, and sign in / create account or sign out. It closes when a page
 * is chosen, on Escape, and on a tap outside it.
 */
export function MobileMenu({
  links,
  badges,
  locale,
  signedIn,
}: {
  links: NavLink[];
  badges: Record<string, number>;
  locale: string;
  signedIn: boolean;
}) {
  const t = useTranslations('nav');
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const waiting = Object.values(badges).reduce((sum, count) => sum + count, 0);

  // A new page closes the menu.
  useEffect(() => setOpen(false), [pathname]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && setOpen(false);
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="md:hidden">
      <button
        type="button"
        className="btn-icon relative"
        aria-expanded={open}
        aria-controls="mobile-menu"
        aria-label={open ? t('closeMenu') : t('openMenu')}
        onClick={() => setOpen((current) => !current)}
      >
        <svg aria-hidden viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          {open ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
        </svg>
        {!open && waiting > 0 && (
          <span aria-hidden className="absolute -end-0.5 -top-0.5 size-2.5 rounded-full bg-brass-500 ring-2 ring-page" />
        )}
      </button>

      {open && (
        <div
          id="mobile-menu"
          className="absolute inset-x-0 top-full animate-fade-in border-b border-line bg-page shadow-lift"
        >
          <div className="space-y-4 px-4 py-4">
            {links.length > 0 && (
              <nav className="flex flex-col gap-1 [&_a]:w-full [&_a]:rounded-md [&_a]:px-3 [&_a]:py-2.5 [&_a]:text-base">
                <NavLinks links={links} badges={badges} />
              </nav>
            )}

            <div className="flex items-center justify-between border-t border-line pt-4">
              <span className="text-xs text-muted">{t('languageLabel')}</span>
              <LocaleSwitcher locale={locale} />
            </div>

            <div className="flex flex-col gap-2 border-t border-line pt-4">
              {signedIn ? (
                <button
                  type="button"
                  className="btn-secondary w-full"
                  onClick={() => signOut({ callbackUrl: `/${locale}` })}
                >
                  {t('logout')}
                </button>
              ) : (
                <>
                  <Link href="/login" className="btn-secondary w-full">
                    {t('login')}
                  </Link>
                  <Link href="/register" className="btn-primary w-full">
                    {t('register')}
                  </Link>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

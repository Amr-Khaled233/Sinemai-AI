'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';

export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'sinemai-theme';

/**
 * Runs before first paint, so the page never flashes the wrong theme. It
 * always sets `data-theme`: the stored choice, or dark on a first visit.
 * Kept as a string because it has to be inlined into <head> by the layout.
 */
export const THEME_INIT_SCRIPT = `(function(){var t='dark';try{if(localStorage.getItem('${STORAGE_KEY}')==='light')t='light';}catch(e){}document.documentElement.setAttribute('data-theme',t);})();`;

function current(): Theme {
  return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
}

function apply(theme: Theme) {
  document.documentElement.setAttribute('data-theme', theme);
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Private windows: the page still switches, the choice just is not kept.
  }
}

export function ThemeToggle() {
  const t = useTranslations('theme');
  const [theme, setTheme] = useState<Theme | null>(null);

  useEffect(() => setTheme(current()), []);

  // The button names what it switches to, which is what a click will do.
  const next: Theme = theme === 'light' ? 'dark' : 'light';

  return (
    <button
      type="button"
      className="btn-icon"
      aria-label={t(next)}
      title={t(next)}
      onClick={() => {
        apply(next);
        setTheme(next);
      }}
    >
      {theme === 'light' ? <MoonIcon /> : <SunIcon />}
    </button>
  );
}

function SunIcon() {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
    </svg>
  );
}

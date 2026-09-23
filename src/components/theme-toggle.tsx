'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';

export type Theme = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'sinemai-theme';

/**
 * Runs before first paint so a dark-mode visitor never sees a white flash.
 * Kept as a string because it has to be inlined into <head> by the layout.
 */
export const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem('${STORAGE_KEY}');if(t==='dark'||t==='light'){document.documentElement.setAttribute('data-theme',t);}}catch(e){}})();`;

function readStored(): Theme {
  if (typeof window === 'undefined') return 'system';
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === 'dark' || value === 'light' ? value : 'system';
  } catch {
    // Private windows and blocked storage fall back to following the OS.
    return 'system';
  }
}

function apply(theme: Theme) {
  const root = document.documentElement;
  if (theme === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);
  try {
    if (theme === 'system') localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Preference simply does not persist; the page still switches.
  }
}

export function ThemeToggle() {
  const t = useTranslations('theme');
  const [theme, setTheme] = useState<Theme>('system');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setTheme(readStored());
    setMounted(true);
  }, []);

  // Cycles system → dark → light → system, so "follow the OS" stays reachable.
  const next: Theme = theme === 'system' ? 'dark' : theme === 'dark' ? 'light' : 'system';
  const icon = theme === 'dark' ? '🌙' : theme === 'light' ? '☀️' : '🖥️';

  return (
    <button
      type="button"
      className="btn-ghost px-2 text-xs"
      title={mounted ? t(theme) : undefined}
      aria-label={mounted ? t(theme) : 'theme'}
      onClick={() => {
        setTheme(next);
        apply(next);
      }}
    >
      {/* Before hydration the stored choice is unknown, so nothing is asserted. */}
      <span aria-hidden>{mounted ? icon : '◐'}</span>
    </button>
  );
}

import type { Config } from 'tailwindcss';

/** Every semantic colour resolves through a CSS variable, so light and dark are data, not markup. */
const token = (name: string) => `rgb(var(--${name}) / <alpha-value>)`;

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  // An explicit choice on <html> wins; with no choice the OS preference applies
  // through the media query in globals.css.
  darkMode: ['class', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        page: token('page'),
        surface: {
          DEFAULT: token('surface'),
          raised: token('surface-raised'),
          sunken: token('surface-sunken'),
        },
        line: {
          DEFAULT: token('line'),
          strong: token('line-strong'),
        },
        strong: token('text-strong'),
        body: token('text-body'),
        muted: token('muted'),
        accent: {
          DEFAULT: token('accent'),
          soft: token('accent-soft'),
        },
        danger: token('danger'),
        warning: token('warning'),
        success: token('success'),
        info: token('info'),

        // Fixed palette, used where a colour must not shift between themes
        // (the gold primary button, brand marks, chart-like accents).
        ink: {
          950: '#08090d',
          900: '#0d0f14',
          800: '#14171f',
          700: '#1d222c',
          600: '#2a3040',
        },
        brass: {
          400: '#e8c37a',
          500: '#d4a94f',
          600: '#b38c33',
        },
        teal: {
          400: '#4fd1c5',
          500: '#2bb3a6',
        },
      },
      textColor: {
        strong: token('text-strong'),
        body: token('text-body'),
        muted: token('muted'),
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'system-ui', 'sans-serif'],
      },
      keyframes: {
        'fade-up': {
          from: { opacity: '0', transform: 'translateY(6px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        'fade-up': 'fade-up .35s ease-out both',
      },
    },
  },
  plugins: [],
};

export default config;

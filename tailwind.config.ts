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
        // (the primary button, brand marks, chart marks): a warm charcoal and
        // one signal yellow, the way a rental house's own branding reads.
        ink: {
          950: '#141213',
          900: '#1b1819',
          800: '#242021',
          700: '#2e2a2b',
          600: '#3a3536',
        },
        brass: {
          400: '#ebc94f',
          500: '#e3b823',
          600: '#c49c12',
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
        // Condensed display face for headings, labels and buttons.
        display: ['var(--font-display)', 'var(--font-sans)', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        card: '0 1px 2px rgb(var(--shadow) / 0.04), 0 8px 24px -12px rgb(var(--shadow) / 0.18)',
        lift: '0 2px 4px rgb(var(--shadow) / 0.06), 0 18px 40px -16px rgb(var(--shadow) / 0.28)',
        inset: 'inset 0 1px 0 0 rgb(255 255 255 / 0.04)',
      },
      transitionTimingFunction: {
        // A single easing curve keeps every motion in the product related.
        smooth: 'cubic-bezier(0.22, 1, 0.36, 1)',
      },
      keyframes: {
        'fade-up': {
          from: { opacity: '0', transform: 'translate3d(0, 14px, 0)' },
          to: { opacity: '1', transform: 'translate3d(0, 0, 0)' },
        },
        'fade-in': {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        'scale-in': {
          from: { opacity: '0', transform: 'scale(0.96)' },
          to: { opacity: '1', transform: 'scale(1)' },
        },
        // Direction-neutral so it reads the same in RTL and LTR.
        shimmer: {
          '0%': { backgroundPosition: '200% 0' },
          '100%': { backgroundPosition: '-200% 0' },
        },
        'pulse-ring': {
          '0%': { transform: 'scale(0.9)', opacity: '0.7' },
          '70%': { transform: 'scale(1.6)', opacity: '0' },
          '100%': { transform: 'scale(1.6)', opacity: '0' },
        },
        'grow-x': {
          from: { transform: 'scaleX(0)' },
          to: { transform: 'scaleX(1)' },
        },
        'draw-check': {
          from: { strokeDashoffset: '24' },
          to: { strokeDashoffset: '0' },
        },
      },
      animation: {
        'fade-up': 'fade-up .5s cubic-bezier(0.22, 1, 0.36, 1) both',
        'fade-in': 'fade-in .4s ease-out both',
        'scale-in': 'scale-in .25s cubic-bezier(0.22, 1, 0.36, 1) both',
        shimmer: 'shimmer 1.8s linear infinite',
        'pulse-ring': 'pulse-ring 1.8s cubic-bezier(0.22, 1, 0.36, 1) infinite',
        'grow-x': 'grow-x .8s cubic-bezier(0.22, 1, 0.36, 1) both',
        'draw-check': 'draw-check .4s ease-out .1s both',
      },
    },
  },
  plugins: [],
};

export default config;

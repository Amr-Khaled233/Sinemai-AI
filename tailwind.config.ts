import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
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
      fontFamily: {
        sans: ['var(--font-sans)', 'system-ui', 'sans-serif'],
      },
      keyframes: {
        'fade-up': {
          from: { opacity: '0', transform: 'translateY(6px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        shimmer: {
          '100%': { transform: 'translateX(100%)' },
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

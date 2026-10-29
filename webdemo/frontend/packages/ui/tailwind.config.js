import tailwindcssAnimate from 'tailwindcss-animate';

/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ['class'],
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: 'hsl(var(--primary) / <alpha-value>)',
          foreground: 'hsl(var(--primary-foreground) / <alpha-value>)',
          50: '#EEF2FF',
          100: '#E0E7FF',
          200: '#C7D2FE',
          300: '#A5B4FC',
          400: '#818CF8',
          500: '#6366F1',
          600: '#4F46E5',
          700: '#4338CA',
          800: '#3730A3',
          900: '#312E81',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary) / <alpha-value>)',
          foreground: 'hsl(var(--secondary-foreground) / <alpha-value>)',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent) / <alpha-value>)',
          foreground: 'hsl(var(--accent-foreground) / <alpha-value>)',
        },
        background: 'hsl(var(--background) / <alpha-value>)',
        foreground: 'hsl(var(--foreground) / <alpha-value>)',
        border: 'hsl(var(--border) / <alpha-value>)',
        input: 'hsl(var(--input) / <alpha-value>)',
        ring: 'hsl(var(--ring) / <alpha-value>)',
        card: {
          DEFAULT: 'hsl(var(--card) / <alpha-value>)',
          foreground: 'hsl(var(--card-foreground) / <alpha-value>)',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted) / <alpha-value>)',
          foreground: 'hsl(var(--muted-foreground) / <alpha-value>)',
        },
        'table-row-hover': 'hsl(var(--table-row-hover) / <alpha-value>)',
        destructive: {
          DEFAULT: 'hsl(var(--destructive) / <alpha-value>)',
          foreground: 'hsl(var(--destructive-foreground) / <alpha-value>)',
        },
        // ---- Status colors: HSL tokens from theme.css; light and dark switch automatically ----
        success: {
          DEFAULT: 'hsl(var(--success) / <alpha-value>)',
          foreground: 'hsl(var(--success-foreground) / <alpha-value>)',
        },
        warning: {
          DEFAULT: 'hsl(var(--warning) / <alpha-value>)',
          foreground: 'hsl(var(--warning-foreground) / <alpha-value>)',
        },
        info: {
          DEFAULT: 'hsl(var(--info) / <alpha-value>)',
          foreground: 'hsl(var(--info-foreground) / <alpha-value>)',
        },
        // ---- Chart palette: charts use chart-1..6 only; do not hard-code hex ----
        chart: {
          1: 'hsl(var(--chart-1) / <alpha-value>)',
          2: 'hsl(var(--chart-2) / <alpha-value>)',
          3: 'hsl(var(--chart-3) / <alpha-value>)',
          4: 'hsl(var(--chart-4) / <alpha-value>)',
          5: 'hsl(var(--chart-5) / <alpha-value>)',
          6: 'hsl(var(--chart-6) / <alpha-value>)',
        },
        annotation: {
          foreground: 'hsl(var(--annotation-foreground) / <alpha-value>)',
        },
        'ocr-confidence': {
          high: 'hsl(var(--ocr-confidence-high) / <alpha-value>)',
          low: 'hsl(var(--ocr-confidence-low) / <alpha-value>)',
          error: 'hsl(var(--ocr-confidence-error) / <alpha-value>)',
          neutral: 'hsl(var(--ocr-confidence-neutral) / <alpha-value>)',
        },
        'ocr-link': 'hsl(var(--ocr-link) / <alpha-value>)',
      },
      fontFamily: {
        // Inter handles English and digits; Noto Sans SC plus system Chinese fonts keep Chinese consistent and natural on every platform.
        sans: [
          'Inter',
          'Noto Sans SC',
          'PingFang SC',
          'Hiragino Sans GB',
          'Microsoft YaHei UI',
          'Microsoft YaHei',
          'sans-serif',
        ],
        // Numbers, scores, latency, JSON, and code use monospace, with tabular-nums for alignment.
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
      // ---- Radius: one --radius base; sm/md/lg are derived (shadcn standard) ----
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      // ---- Spacing: fill in Tailwind’s missing numeric steps plus layout semantic sizes ----
      spacing: {
        4.5: '1.125rem', // 18px
        13: '3.25rem', // 52px
        15: '3.75rem', // 60px
        18: '4.5rem', // 72px
        header: '3.5rem', // Top bar height (h-header)
        sidebar: '15rem', // Expanded sidebar width (w-sidebar)
        'sidebar-collapsed': '4rem', // Collapsed sidebar width (w-sidebar-collapsed)
      },
      // ---- Shadow: cards use shadow instead of a border for depth, and hover deepens it ----
      boxShadow: {
        card: '0 2px 8px 0 rgb(0 0 0 / 0.04)',
        'card-hover': '0 8px 24px -4px rgb(0 0 0 / 0.12), 0 2px 6px -2px rgb(0 0 0 / 0.06)',
      },
    },
  },
  plugins: [tailwindcssAnimate],
};

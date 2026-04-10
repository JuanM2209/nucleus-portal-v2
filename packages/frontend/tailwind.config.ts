import type { Config } from 'tailwindcss';

/** Helper: reference a CSS variable holding space-separated RGB channels */
const rgb = (name: string) => `rgb(var(--${name}) / <alpha-value>)`;

const config: Config = {
  darkMode: 'class',
  content: [
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // Industrial Sentinel Design System — RGB channel vars for opacity support
        'surface-container-low': rgb('surface-container-low'),
        'primary-fixed-dim': rgb('primary-fixed-dim'),
        'surface-bright': rgb('surface-bright'),
        'on-primary': rgb('on-primary'),
        'surface-variant': rgb('surface-variant'),
        'primary-fixed': rgb('primary-fixed'),
        'on-surface': rgb('on-surface'),
        'secondary': rgb('secondary'),
        'surface-dim': rgb('surface-dim'),
        'on-background': rgb('on-background'),
        'outline': rgb('outline'),
        'on-primary-fixed': rgb('on-primary-fixed'),
        'on-primary-container': rgb('on-primary-container'),
        'background': rgb('background'),
        'inverse-on-surface': rgb('inverse-on-surface'),
        'primary-container': rgb('primary-container'),
        'on-secondary': rgb('on-secondary'),
        'surface-container-lowest': rgb('surface-container-lowest'),
        'secondary-fixed-dim': rgb('secondary-fixed-dim'),
        'secondary-fixed': rgb('secondary-fixed'),
        'tertiary-fixed': rgb('tertiary-fixed'),
        'on-secondary-fixed-variant': rgb('on-secondary-fixed-variant'),
        'primary': rgb('primary'),
        'tertiary': rgb('tertiary'),
        'on-tertiary-container': rgb('on-tertiary-container'),
        'surface': rgb('surface'),
        'inverse-primary': rgb('inverse-primary'),
        'on-surface-variant': rgb('on-surface-variant'),
        'tertiary-container': rgb('tertiary-container'),
        'on-error-container': rgb('on-error-container'),
        'on-tertiary-fixed': rgb('on-tertiary-fixed'),
        'on-error': rgb('on-error'),
        'on-primary-fixed-variant': rgb('on-primary-fixed-variant'),
        'on-tertiary-fixed-variant': rgb('on-tertiary-fixed-variant'),
        'surface-container-high': rgb('surface-container-high'),
        'surface-container': rgb('surface-container'),
        'error': rgb('error'),
        'tertiary-fixed-dim': rgb('tertiary-fixed-dim'),
        'surface-container-highest': rgb('surface-container-highest'),
        'error-container': rgb('error-container'),
        'surface-tint': rgb('surface-tint'),
        'on-secondary-fixed': rgb('on-secondary-fixed'),
        'outline-variant': rgb('outline-variant'),
        'on-tertiary': rgb('on-tertiary'),
        'secondary-container': rgb('secondary-container'),
        'on-secondary-container': rgb('on-secondary-container'),
        'inverse-surface': rgb('inverse-surface'),
      },
      fontFamily: {
        headline: ['Manrope', 'system-ui', 'sans-serif'],
        body: ['Inter', 'system-ui', 'sans-serif'],
        label: ['Inter', 'system-ui', 'sans-serif'],
        technical: ['JetBrains Mono', 'monospace'],
      },
      borderRadius: {
        DEFAULT: '0.25rem',
        lg: '0.5rem',
        xl: '1.5rem',
        full: '9999px',
      },
    },
  },
  plugins: [],
};

export default config;

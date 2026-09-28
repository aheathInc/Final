import type { Config } from 'tailwindcss';

/*
 * Colour carries clinical meaning and nothing else.
 *
 * On a triage queue that stops being a style preference and starts doing
 * work: clay marks an emergency, amber marks urgent, and a routine case gets
 * no accent at all. A clinician scanning twenty rows finds the one that
 * cannot wait without reading a word. Decorating every row would destroy
 * exactly the signal this exists for — which is why there is no "brand
 * colour" applied for its own sake anywhere in this app.
 */
const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#10241F',
        'ink-soft': '#4A5F59',
        paper: '#F4F6F2',
        'paper-sunk': '#E7EBE5',
        line: '#D2D9D1',
        petrol: '#0F4C43',
        'petrol-lift': '#17685C',
        amber: '#C2700B',
        clay: '#A63D2F',
      },
      fontFamily: {
        sans: ['var(--font-plex-sans)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['var(--font-plex-mono)', 'ui-monospace', 'monospace'],
      },
    },
  },
  plugins: [],
};

export default config;

import type { Config } from 'tailwindcss';
import uiConfig from '../../packages/ui/tailwind.config';

const config: Config = {
  ...uiConfig,
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    '../../packages/*/src/**/*.{ts,tsx}',
    '../../modules/*/src/**/*.{ts,tsx}',
  ],
};

export default config;

import sharedConfig from './packages/ui/tailwind.config.js';

export default {
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
    './packages/ui/src/**/*.{js,ts,jsx,tsx}',
  ],
  presets: [sharedConfig],
  theme: {
    extend: {},
  },
  plugins: [],
};

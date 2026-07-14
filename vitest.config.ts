import path from 'node:path';
import { defineConfig } from 'vitest/config';

// '@/*' -> './src/*', same alias tsconfig.json defines for Next's own
// build. Needed the first time a test imports a route.ts file directly
// (src/app/api/offer/route.test.ts) -- every route handler in this repo
// imports its lib helpers via '@/...', and without this alias vitest can't
// resolve those imports at all, mocked or not.
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});

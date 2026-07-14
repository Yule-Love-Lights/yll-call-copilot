import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
  resolve: {
    // Mirrors tsconfig.json's "@/*" -> "./src/*" path so route.ts files
    // (which import via the @/ alias) can be imported directly in tests --
    // needed for the digest role-gate route tests.
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});

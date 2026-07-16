import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    // Mirrors tsconfig.json's "@/*" -> "./src/*" path alias so route tests
    // (which import route.ts files using '@/lib/...') resolve the same way
    // the app itself does.
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
  resolve: {
    // Mirrors tsconfig.json's "@/*" -> "./src/*" path alias so tests can
    // import app/api route handlers (which use the alias) directly.
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
});

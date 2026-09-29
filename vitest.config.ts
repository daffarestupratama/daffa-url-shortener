import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['shared/**/*.test.ts', 'apps/dashboard/src/worker/**/*.test.ts'],
  },
});

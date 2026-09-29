import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'shared/**/*.test.ts',
      'apps/dashboard/src/worker/**/*.test.ts',
      'apps/dashboard/src/client/**/*.test.ts',
    ],
    // CSS is skipped in tests by default, which empties `?raw` imports.
    // tokens.test.ts reads tokens.css this way to compare it with shared/tokens.ts.
    css: { include: [/tokens\.css/] },
  },
});

import { readFileSync } from 'node:fs';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

/**
 * Wrangler imports .ico and .png files as Data modules, an ArrayBuffer of the
 * file (apps/redirector/wrangler.jsonc). Vite would turn them into asset URLs,
 * so tests load them the way Wrangler does.
 */
const dataModules: Plugin = {
  name: 'wrangler-data-modules',
  enforce: 'pre',
  load(id) {
    const file = id.split('?')[0] ?? id;
    if (!/\.(ico|png)$/.test(file)) return null;
    const base64 = readFileSync(file).toString('base64');
    return `export default Uint8Array.from(atob(${JSON.stringify(base64)}), (c) => c.charCodeAt(0)).buffer;`;
  },
};

export default defineConfig({
  plugins: [dataModules],
  test: {
    include: [
      'shared/**/*.test.ts',
      'apps/redirector/src/**/*.test.ts',
      'apps/dashboard/src/worker/**/*.test.ts',
      'apps/dashboard/src/client/**/*.test.ts',
    ],
    // CSS is skipped in tests by default, which empties `?raw` imports.
    // tokens.test.ts reads tokens.css this way to compare it with shared/tokens.ts.
    css: { include: [/tokens\.css/] },
  },
});

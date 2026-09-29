import { cloudflare } from '@cloudflare/vite-plugin';
import react from '@vitejs/plugin-react';
import { createRequire } from 'node:module';
import path from 'node:path';
import { defineConfig } from 'vite';

// country-flag-icons only exports its CSS from the 3x2 folder, not the SVG
// files. The CSS sits next to them, so its folder is the flag folder. Resolving
// it through Node keeps this working however npm hoists the package.
const require = createRequire(import.meta.url);
const flagsDir = path.dirname(require.resolve('country-flag-icons/3x2/flags.css'));

export default defineConfig({
  // A fixed port keeps the smoke test URL and the dev CSRF origin stable.
  server: { port: 5173, strictPort: true },
  resolve: {
    alias: { '@flags': flagsDir },
  },
  plugins: [
    react(),
    cloudflare({
      // Resolved as <vite root>/../../.wrangler-state/v3, the same layout that
      // `wrangler dev --persist-to .wrangler-state` uses for the redirector.
      persistState: { path: '../../.wrangler-state' },
      // wrangler dev takes 9229. Pinning this avoids a race when both start
      // together under `npm run dev`.
      inspectorPort: 9230,
    }),
  ],
});

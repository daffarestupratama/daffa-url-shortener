import { cloudflare } from '@cloudflare/vite-plugin';
import { defineConfig } from 'vite';

export default defineConfig({
  // A fixed port keeps the smoke test URL and the dev CSRF origin stable.
  server: { port: 5173, strictPort: true },
  plugins: [
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

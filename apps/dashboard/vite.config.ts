import { cloudflare } from '@cloudflare/vite-plugin';
import react from '@vitejs/plugin-react';
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { defineConfig, type Plugin } from 'vite';

// country-flag-icons only exports its CSS from the 3x2 folder, not the SVG
// files. The CSS sits next to them, so its folder is the flag folder. Resolving
// it through Node keeps this working however npm hoists the package.
const require = createRequire(import.meta.url);
const flagsDir = path.dirname(require.resolve('country-flag-icons/3x2/flags.css'));

const repoRoot = path.resolve(import.meta.dirname, '../..');

/** A module id as a POSIX path from the repository root. Virtual ids stay as they are. */
function moduleName(id: string): string {
  if (id.startsWith('\0')) return id;
  const clean = id.split('?')[0]!;
  return path.isAbsolute(clean) ? path.relative(repoRoot, clean).split(path.sep).join('/') : clean;
}

/**
 * Writes dist/client-chunks.json after a client build: every chunk with the
 * modules inside it and the chunks it imports. scripts/check-bundle.mjs reads
 * it to prove that the public page never loads dashboard code and the other
 * way round. The file sits next to dist/client, not in it, so it is never
 * deployed as a static asset.
 */
function chunkMap(): Plugin {
  return {
    name: 'daffa-chunk-map',
    apply: 'build',
    applyToEnvironment: (environment) => environment.name === 'client',
    writeBundle(options, bundle) {
      const chunks = Object.values(bundle)
        .filter((output) => output.type === 'chunk')
        .map((chunk) => {
          const ids = chunk.moduleIds ?? Object.keys(chunk.modules);
          const meta = (chunk as { viteMetadata?: { importedCss?: Set<string> } }).viteMetadata;
          return {
            file: chunk.fileName,
            isEntry: chunk.isEntry,
            isDynamicEntry: chunk.isDynamicEntry,
            facadeModuleId: chunk.facadeModuleId ? moduleName(chunk.facadeModuleId) : null,
            modules: ids.map(moduleName),
            imports: chunk.imports,
            dynamicImports: chunk.dynamicImports,
            css: [...(meta?.importedCss ?? [])],
          };
        });
      const out = path.resolve(options.dir ?? 'dist/client', '..', 'client-chunks.json');
      writeFileSync(out, `${JSON.stringify({ chunks }, null, 2)}\n`);
    },
  };
}

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
    chunkMap(),
  ],
});

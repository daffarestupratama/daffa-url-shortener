import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Bundles a TypeScript entry point to a temporary ESM file and imports it, so
 * the plain Node scripts in this folder can use the Worker source directly
 * without a build step. Works the same on Windows and POSIX.
 */
export async function importTs(entry) {
  const dir = await mkdtemp(path.join(tmpdir(), 'daffa-'));
  const outfile = path.join(dir, 'bundle.mjs');
  try {
    await build({
      entryPoints: [path.resolve(ROOT, entry)],
      outfile,
      bundle: true,
      format: 'esm',
      platform: 'neutral',
      target: 'es2022',
      loader: { '.txt': 'text' },
      logLevel: 'silent',
    });
    return await import(pathToFileURL(outfile).href);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

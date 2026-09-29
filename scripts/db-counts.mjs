import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ROOT } from './bundle.mjs';

/**
 * Prints row counts and the id to slug mapping of the local database as JSON,
 * so two seed runs can be compared exactly. The seed is expected to produce the
 * same output every time: the checklist URLs (/links/1 for cv, /links/9 for
 * jadwal) depend on the ids staying put.
 */

const SQL = [
  'SELECT (SELECT COUNT(*) FROM links) AS links, (SELECT COUNT(*) FROM tags) AS tags, (SELECT COUNT(*) FROM link_tags) AS link_tags, (SELECT COUNT(*) FROM clicks) AS clicks, (SELECT COUNT(*) FROM clicks WHERE is_bot = 1) AS bot_clicks;',
  'SELECT id, slug FROM links ORDER BY id;',
  'SELECT l.slug, COUNT(c.id) AS clicks FROM links l LEFT JOIN clicks c ON c.link_id = l.id GROUP BY l.id ORDER BY l.id;',
].join('\n');

const dir = await mkdtemp(path.join(tmpdir(), 'daffa-counts-'));
const file = path.join(dir, 'counts.sql');
try {
  await writeFile(file, SQL, 'utf8');
  const run = spawnSync(
    'npx',
    ['wrangler', 'd1', 'execute', 'daffa-links', '--local', '--persist-to', '.wrangler-state', '-c', 'apps/redirector/wrangler.jsonc', '--json', '--file', `"${file}"`],
    { cwd: ROOT, encoding: 'utf8', shell: true },
  );
  if (run.status !== 0) {
    console.error(run.stdout, run.stderr);
    process.exit(run.status ?? 1);
  }
  const results = JSON.parse(run.stdout.slice(run.stdout.indexOf('[')));
  const totals = results[0].results[0];
  const ids = Object.fromEntries(results[1].results.map((row) => [row.id, row.slug]));
  const perLink = Object.fromEntries(results[2].results.map((row) => [row.slug, row.clicks]));
  console.log(JSON.stringify({ totals, ids, clicksPerLink: perLink }, null, 2));
} finally {
  await rm(dir, { recursive: true, force: true });
}

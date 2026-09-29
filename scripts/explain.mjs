import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ROOT, importTs } from './bundle.mjs';

/**
 * Runs EXPLAIN QUERY PLAN on every read query the dashboard API ships, against
 * the local database, and fails if any of them scans the clicks table instead
 * of using idx_clicks_link_ts or idx_clicks_link_bot_ts.
 *
 * The SQL comes straight from apps/dashboard/src/worker/queries.ts, so this
 * checks what actually runs. Parameters are inlined as literals because
 * `wrangler d1 execute` cannot bind them, and everything goes through one
 * temporary --file to avoid shell quoting on Windows.
 */

const CLICK_INDEXES = ['idx_clicks_link_ts', 'idx_clicks_link_bot_ts'];

function literal(value) {
  if (value === null) return 'NULL';
  if (typeof value === 'number') return String(value);
  return `'${String(value).replace(/'/g, "''")}'`;
}

/** Replaces ?N placeholders, highest number first so ?1 never eats the start of ?10. */
function inline(sql, params) {
  let out = sql;
  for (let index = params.length; index >= 1; index -= 1) {
    out = out.replaceAll(`?${index}`, literal(params[index - 1]));
  }
  return out;
}

const { EXPLAIN_CASES } = await importTs('apps/dashboard/src/worker/queries.ts');

const dir = await mkdtemp(path.join(tmpdir(), 'daffa-explain-'));
const file = path.join(dir, 'explain.sql');
try {
  const statements = EXPLAIN_CASES.map((c) => `EXPLAIN QUERY PLAN ${inline(c.sql, c.params)};`);
  await writeFile(file, statements.join('\n'), 'utf8');

  const run = spawnSync(
    'npx',
    [
      'wrangler', 'd1', 'execute', 'daffa-links', '--local',
      '--persist-to', '.wrangler-state',
      '-c', 'apps/redirector/wrangler.jsonc',
      '--json', '--file', `"${file}"`,
    ],
    { cwd: ROOT, encoding: 'utf8', shell: true, maxBuffer: 16 * 1024 * 1024 },
  );
  if (run.status !== 0) {
    console.error(run.stdout, run.stderr);
    console.error('\nwrangler d1 execute failed. Run `npm run migrate:local` first.');
    process.exit(run.status ?? 1);
  }

  const start = run.stdout.indexOf('[');
  const results = JSON.parse(run.stdout.slice(start));
  if (results.length !== EXPLAIN_CASES.length) {
    throw new Error(`Expected ${EXPLAIN_CASES.length} plans, received ${results.length}.`);
  }

  let failures = 0;
  console.log('EXPLAIN QUERY PLAN, local database\n');

  EXPLAIN_CASES.forEach((testCase, index) => {
    const rows = results[index].results ?? [];
    const details = rows.map((row) => row.detail);
    const scansClicks = details.some((detail) => /\bSCAN (c|clicks)\b/.test(detail));
    const usedIndexes = CLICK_INDEXES.filter((name) => details.some((d) => d.includes(name)));

    let verdict;
    if (!testCase.readsClicks) {
      verdict = 'INFO  does not read clicks';
    } else if (scansClicks) {
      verdict = 'FAIL  full scan on clicks';
      failures += 1;
    } else if (usedIndexes.length === 0) {
      verdict = 'FAIL  reads clicks without a clicks index';
      failures += 1;
    } else {
      verdict = `PASS  ${usedIndexes.join(', ')}`;
    }

    console.log(`${verdict.padEnd(46)} ${testCase.name}`);
    // Indent by depth: SQLite reports each step with its parent id.
    const depth = new Map([[0, 0]]);
    for (const row of rows) {
      const level = (depth.get(row.parent) ?? 0) + 1;
      depth.set(row.id, level);
      console.log(`      ${'  '.repeat(level - 1)}${row.detail}`);
    }
  });

  console.log('');
  if (failures > 0) {
    console.error(`${failures} of ${EXPLAIN_CASES.length} queries do not use a clicks index.`);
    process.exit(1);
  }
  console.log(`All ${EXPLAIN_CASES.length} queries checked. None scans the clicks table.`);
} finally {
  await rm(dir, { recursive: true, force: true });
}

import { importTs } from './bundle.mjs';
import { d1Local } from './d1.mjs';

/**
 * Runs EXPLAIN QUERY PLAN on every query the dashboard API and the redirector
 * ship, against the local database. Fails if any of them scans the clicks
 * table instead of using idx_clicks_link_ts or idx_clicks_link_bot_ts, and
 * fails if a case marked `noScan` scans any table at all. The redirector
 * cases are marked, since they run on every click.
 *
 * The SQL comes straight from apps/dashboard/src/worker/queries.ts and
 * apps/redirector/src/sql.ts, so this checks what actually runs. Parameters
 * are inlined as literals because `wrangler d1 execute` cannot bind them.
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

const dashboard = await importTs('apps/dashboard/src/worker/queries.ts');
const redirector = await importTs('apps/redirector/src/sql.ts');
const EXPLAIN_CASES = [...redirector.EXPLAIN_CASES, ...dashboard.EXPLAIN_CASES];

let results;
try {
  const statements = EXPLAIN_CASES.map((c) => `EXPLAIN QUERY PLAN ${inline(c.sql, c.params)};`);
  results = await d1Local(statements.join('\n'));
} catch (error) {
  console.error(String(error.message ?? error));
  process.exit(1);
}
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
  const scanned = testCase.noScan ? details.filter((detail) => /^SCAN /.test(detail)) : [];

  let verdict;
  if (scanned.length > 0) {
    verdict = `FAIL  ${scanned.join(', ')}`;
    failures += 1;
  } else if (testCase.readsClicks && scansClicks) {
    verdict = 'FAIL  full scan on clicks';
    failures += 1;
  } else if (testCase.readsClicks && usedIndexes.length === 0) {
    verdict = 'FAIL  reads clicks without a clicks index';
    failures += 1;
  } else if (testCase.readsClicks) {
    verdict = `PASS  ${usedIndexes.join(', ')}`;
  } else if (testCase.noScan) {
    verdict = 'PASS  index lookups only';
  } else {
    verdict = 'INFO  does not read clicks';
  }

  console.log(`${verdict.padEnd(52)} ${testCase.name}`);
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
  console.error(`${failures} of ${EXPLAIN_CASES.length} queries scan a table they must not scan.`);
  process.exit(1);
}
console.log(`All ${EXPLAIN_CASES.length} queries checked. None scans clicks, and the redirector scans nothing.`);

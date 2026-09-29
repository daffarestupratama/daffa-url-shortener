import { importTs } from './bundle.mjs';

/**
 * The design promises each visitor page stays under 3 KB. Measured against the
 * worst case: a slug at the 80 character maximum.
 */
const LIMIT = 3072;
const WORST_CASE_SLUG = 'a'.repeat(80);
const REALISTIC_SLUG = 'data-workshop-materials';

const pages = await importTs('apps/redirector/src/pages.ts');

const CASES = [
  ['404 not found', pages.renderNotFound],
  ['410 gone', pages.renderGone],
  ['503 unavailable', pages.renderUnavailable],
];

const encoder = new TextEncoder();
let failed = false;

console.log(`Visitor page size, limit ${LIMIT} bytes\n`);

for (const [name, render] of CASES) {
  const worst = encoder.encode(render(WORST_CASE_SLUG)).byteLength;
  const realistic = encoder.encode(render(REALISTIC_SLUG)).byteLength;
  const ok = worst <= LIMIT;
  if (!ok) failed = true;
  const mark = ok ? 'PASS' : 'FAIL';
  const headroom = LIMIT - worst;
  console.log(
    `  ${mark}  ${name.padEnd(16)} ${String(worst).padStart(5)} bytes worst case` +
      `, ${String(realistic).padStart(5)} bytes typical` +
      `, ${headroom >= 0 ? `${headroom} to spare` : `${-headroom} over`}`,
  );
}

if (failed) {
  console.error('\nAt least one visitor page is over the 3 KB budget.');
  process.exit(1);
}

console.log('\nAll visitor pages are within budget.');

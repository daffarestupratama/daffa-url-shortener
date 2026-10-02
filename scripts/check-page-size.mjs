import { importTs } from './bundle.mjs';

/**
 * The design promises each visitor page stays under 3 KB.
 *
 * The 404, 410, and 503 pages are measured against a slug at the 80 character
 * maximum. The two public limit pages are only ever served for public links,
 * whose slugs are always exactly 6 characters, so that is their worst case.
 *
 * The public link notice prints the destination URL twice, in the Continue
 * href and in the destination well. Its budget therefore excludes every
 * occurrence of the escaped URL, measured with a typical destination. The real
 * worst case with a 2048 character URL is reported on its own line, for
 * information only.
 */
const LIMIT = 3072;
const WORST_CASE_SLUG = 'a'.repeat(80);
const REALISTIC_SLUG = 'data-workshop-materials';
const PUBLIC_SLUG = 'x7kq2m';
const TYPICAL_URL = 'https://docs.google.com/forms/d/e/1FAIpQLSd3kR9vQx/viewform?usp=sf_link';
/** A 63 character label, the longest allowed, then a query of ampersands that each escape to 5 bytes. */
const WORST_URL_START = `https://${'h'.repeat(63)}.example.com/?`;
const WORST_URL = WORST_URL_START + '&'.repeat(2048 - WORST_URL_START.length);

const pages = await importTs('apps/redirector/src/pages.ts');

const encoder = new TextEncoder();
const bytes = (text) => encoder.encode(text).byteLength;
const escaped = (url) =>
  url.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

let failed = false;

function report(name, worst, typical) {
  const ok = worst <= LIMIT;
  if (!ok) failed = true;
  const mark = ok ? 'PASS' : 'FAIL';
  const headroom = LIMIT - worst;
  console.log(
    `  ${mark}  ${name.padEnd(22)} ${String(worst).padStart(5)} bytes worst case` +
      `, ${String(typical).padStart(5)} bytes typical` +
      `, ${headroom >= 0 ? `${headroom} to spare` : `${-headroom} over`}`,
  );
}

console.log(`Visitor page size, limit ${LIMIT} bytes\n`);

for (const [name, render] of [
  ['404 not found', pages.renderNotFound],
  ['410 gone', pages.renderGone],
  ['503 unavailable', pages.renderUnavailable],
]) {
  report(name, bytes(render(WORST_CASE_SLUG)), bytes(render(REALISTIC_SLUG)));
}

for (const [name, render] of [
  ['429 link limit', pages.renderLinkLimit],
  ['429 public capacity', pages.renderBusy],
]) {
  const size = bytes(render(PUBLIC_SLUG));
  report(name, size, size);
}

const notice = pages.renderInterstitial(PUBLIC_SLUG, TYPICAL_URL);
const occurrences = notice.split(escaped(TYPICAL_URL)).length - 1;
const noticeBudget = bytes(notice) - occurrences * bytes(escaped(TYPICAL_URL));
report('200 notice, URL apart', noticeBudget, bytes(notice));

const worstNotice = bytes(pages.renderInterstitial(PUBLIC_SLUG, WORST_URL));
console.log(
  `  INFO  200 notice, 2048 URL  ${String(worstNotice).padStart(5)} bytes with a 2048 character URL` +
    ` of ampersands and a 63 character host label, not gated`,
);

if (failed) {
  console.error('\nAt least one visitor page is over the 3 KB budget.');
  process.exit(1);
}

console.log('\nAll visitor pages are within budget.');

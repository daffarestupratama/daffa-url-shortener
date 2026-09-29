import { rootRule, type TokenName } from '@daffa/shared';

/**
 * The three visitor pages, ported from Halaman Pengunjung.dc.html.
 *
 * Each one is a single self contained document: inline CSS, no JavaScript, no
 * web fonts, no images, shadows via box-shadow only, and under 3 KB. The design
 * shows a desktop frame and a 360px frame of the same page, so the sizes that
 * differ between them are interpolated with clamp() rather than duplicated
 * behind a media query.
 *
 * Colors stay in variables. Each page emits a :root holding only the tokens it
 * actually references, which keeps the budget comfortable.
 */

const HOME = 'https://daffarestupratama.com';

/** Valid slugs are at most 80 characters, so this only ever trims junk paths. */
const MAX_SHOWN_SLUG = 80;

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ESCAPES[char] ?? char);
}

const BASE_TOKENS: TokenName[] = [
  '--bg',
  '--ink',
  '--ink2',
  '--sign',
  '--link',
  '--tile-prefix',
  '--tile-hi',
  '--tile-lo',
  '--raise-lg',
  '--raise-sm',
  '--tile-in',
  '--font-system',
  '--mono-system',
];

interface Badge {
  text: string;
  /** Token for the badge background. */
  background: TokenName;
  /** Token for the badge text. `--sh-l` is the project white. */
  foreground: TokenName;
  /** The design gives the dark NOT FOUND badge a deeper inset than the rest. */
  shadow: '--badge-in' | '--badge-in-strong';
}

interface PageSpec {
  status: 404 | 410 | 503;
  badge: Badge;
  heading: string;
  body: (slug: string) => string;
}

function baseCss(badge: Badge): string {
  const tokens: TokenName[] = [
    ...BASE_TOKENS,
    badge.background,
    badge.foreground,
    badge.shadow,
  ];
  // Shared declarations are grouped rather than repeated per selector. The 3 KB
  // budget is tight once the five layer tile shadow is in the :root block.
  return [
    rootRule(tokens),
    '*{box-sizing:border-box}',
    'body,main,.t,.c{display:flex;flex-direction:column}',
    'body,a{align-items:center;justify-content:center;color:var(--ink)}',
    'body,main{background:var(--bg)}',
    '.c,a{gap:10px}',
    '.t,a{border-radius:12px}',
    '.t,small{font-family:var(--mono-system)}',
    '.b,h1,a{font-weight:800}',
    '.t i,small{font-weight:500}',
    '.b,small{font-size:12px;line-height:1}',
    'h1,p{margin:0}',
    'p,small{color:var(--ink2)}',
    'body{margin:0;min-height:100vh;gap:24px;padding:32px 24px;font-family:var(--font-system)}',
    'main{width:100%;max-width:420px;box-shadow:var(--raise-lg);padding:clamp(24px,5vw,32px) clamp(20px,4vw,28px);gap:clamp(20px,3vw,22px)}',
    `.b{align-self:flex-end;letter-spacing:.14em;padding:6px 9px;border-radius:4px;background:var(${badge.background});color:var(${badge.foreground});box-shadow:var(${badge.shadow})}`,
    '.t{gap:8px;padding:clamp(18px,3vw,22px) clamp(16px,3vw,20px);background:linear-gradient(145deg,var(--tile-hi),var(--tile-lo));box-shadow:var(--tile-in)}',
    '.t i{font-style:normal;font-size:clamp(13px,2vw,14px);color:var(--tile-prefix)}',
    '.t b{font-weight:700;font-size:clamp(28px,7vw,40px);line-height:1.1;color:var(--sign);overflow-wrap:anywhere}',
    'h1{font-size:clamp(23px,4vw,26px);line-height:1.2}',
    'p{font-size:16px;line-height:1.55}',
    'a{display:flex;min-height:52px;padding:0 12px;text-align:center;border:1px solid var(--ink);background:var(--sign);font-size:clamp(15px,2.5vw,16px);line-height:1.2;text-decoration:none;box-shadow:var(--raise-sm)}',
    'small{letter-spacing:.06em}',
    'a:focus-visible{outline:3px solid var(--link);outline-offset:3px}',
  ].join('');
}

function render(spec: PageSpec, rawSlug: string): string {
  const shown = escapeHtml(rawSlug.slice(0, MAX_SHOWN_SLUG));
  return [
    '<!doctype html>',
    '<html lang="en"><head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    '<meta name="robots" content="noindex">',
    `<title>${escapeHtml(spec.heading)} · daffa.me</title>`,
    `<style>${baseCss(spec.badge)}</style>`,
    '</head><body>',
    '<main>',
    `<span class="b">${spec.badge.text}</span>`,
    `<div class="t"><i>daffa.me/</i><b>${shown}</b></div>`,
    `<div class="c"><h1>${spec.heading}</h1><p>${spec.body(shown)}</p></div>`,
    `<a href="${HOME}">Go to daffarestupratama.com <span aria-hidden="true">→</span></a>`,
    '</main>',
    `<small>CODE ${spec.status}</small>`,
    '</body></html>',
  ].join('');
}

const NOT_FOUND: PageSpec = {
  status: 404,
  badge: {
    text: 'NOT FOUND',
    background: '--ink',
    foreground: '--sign',
    shadow: '--badge-in-strong',
  },
  heading: 'Link not found',
  body: (slug) =>
    `The address daffa.me/${slug} is not registered. Check the spelling of the link or visit the main site.`,
};

const GONE: PageSpec = {
  status: 410,
  badge: {
    text: 'CLOSED',
    background: '--exp',
    foreground: '--sh-l',
    shadow: '--badge-in',
  },
  heading: 'Link no longer available',
  body: () => 'This link has expired or was deactivated by its owner.',
};

const UNAVAILABLE: PageSpec = {
  status: 503,
  badge: {
    text: 'DELAYED',
    background: '--danger',
    foreground: '--sh-l',
    shadow: '--badge-in',
  },
  heading: 'Service temporarily unavailable',
  body: () => 'The redirect is delayed by a temporary outage. Reload this page in a few minutes.',
};

/** Exported for scripts/check-page-size.mjs and scripts/audit-copy.mjs. */
export const PAGES = { notFound: NOT_FOUND, gone: GONE, unavailable: UNAVAILABLE } as const;

export function renderNotFound(slug: string): string {
  return render(NOT_FOUND, slug);
}

export function renderGone(slug: string): string {
  return render(GONE, slug);
}

export function renderUnavailable(slug: string): string {
  return render(UNAVAILABLE, slug);
}

/**
 * A visitor page never caches: a slug that is missing today may exist tomorrow,
 * and an expired link may be reactivated.
 */
export function pageResponse(html: string, status: number): Response {
  return new Response(html, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store, private',
    },
  });
}

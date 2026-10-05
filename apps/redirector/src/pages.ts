import {
  PUBLIC_DAILY_CLICK_LIMIT,
  hostOf,
  rootRule,
  tokenValue,
  type TokenName,
} from '@daffa/shared';

/**
 * The visitor pages, ported from Halaman Pengunjung.dc.html: not found, gone,
 * unavailable, the two public link limit pages, the attempt limit page of the
 * slug guessing guard, and the public link notice.
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
  status: 404 | 410 | 429 | 503;
  /** The small caption under the card. */
  footer: string;
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
    'body{margin:0;min-height:100vh;gap:clamp(20px,4vw,24px);padding:clamp(20px,5vw,32px) clamp(16px,4vw,24px);font-family:var(--font-system)}',
    'main{width:100%;max-width:420px;border-radius:16px;box-shadow:var(--raise-lg);padding:clamp(24px,5vw,32px) clamp(20px,4vw,28px);gap:clamp(20px,3vw,22px)}',
    `.b{align-self:flex-end;letter-spacing:.14em;padding:6px 9px;border-radius:4px;background:var(${badge.background});color:var(${badge.foreground});box-shadow:var(${badge.shadow})}`,
    '.t{gap:8px;padding:clamp(18px,3vw,22px) clamp(16px,3vw,20px);background:linear-gradient(145deg,var(--tile-hi),var(--tile-lo));box-shadow:var(--tile-in)}',
    '.t i{font-style:normal;font-size:clamp(13px,2vw,14px);line-height:1;color:var(--tile-prefix)}',
    '.t b{font-weight:700;font-size:clamp(28px,7vw,40px);line-height:calc(.82em + 9.3px);color:var(--sign);overflow-wrap:anywhere}',
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
    `<small>${spec.footer}</small>`,
    '</body></html>',
  ].join('');
}

const NOT_FOUND: PageSpec = {
  status: 404,
  footer: 'CODE 404',
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
  footer: 'CODE 410',
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
  footer: 'CODE 503',
  badge: {
    text: 'DELAYED',
    background: '--danger',
    foreground: '--sh-l',
    shadow: '--badge-in',
  },
  heading: 'Service temporarily unavailable',
  body: () => 'The redirect is delayed by a temporary outage. Reload this page in a few minutes.',
};

/** A public link used its own daily clicks. Orange marks a limit that resets on its own. */
const LINK_LIMIT: PageSpec = {
  status: 429,
  footer: 'CODE 429 · LINK LIMIT',
  badge: {
    text: 'FULLY BOOKED',
    background: '--exp',
    foreground: '--sh-l',
    shadow: '--badge-in',
  },
  heading: 'Daily click limit reached',
  body: () =>
    `This public link reached its limit of ${PUBLIC_DAILY_CLICK_LIMIT} clicks for today. The link opens again after the daily reset at 07:00 WIB.`,
};

/** All public links together used the shared daily budget. Grey marks a shared pause. */
const BUSY: PageSpec = {
  status: 429,
  footer: 'CODE 429 · PUBLIC CAPACITY',
  badge: {
    text: 'HOLDING',
    background: '--off',
    foreground: '--sh-l',
    shadow: '--badge-in',
  },
  heading: 'Public links are temporarily busy',
  body: () =>
    'All public links on daffa.me reached the shared daily capacity. Public links open again after the daily reset at 07:00 WIB.',
};

/**
 * One network opened too many addresses that do not exist (see guard.ts).
 * Orange marks a limit that resets on its own, here after about a minute.
 */
const ATTEMPT_LIMIT: PageSpec = {
  status: 429,
  footer: 'CODE 429 · ATTEMPT LIMIT',
  badge: {
    text: 'PAUSED',
    background: '--exp',
    foreground: '--sh-l',
    shadow: '--badge-in',
  },
  heading: 'Too many unknown links',
  body: () =>
    'Many addresses that do not exist were opened from this network in a short time. Short links open again in about one minute.',
};

/** Exported for scripts/check-page-size.mjs and scripts/audit-copy.mjs. */
export const PAGES = {
  notFound: NOT_FOUND,
  gone: GONE,
  unavailable: UNAVAILABLE,
  linkLimit: LINK_LIMIT,
  busy: BUSY,
  attemptLimit: ATTEMPT_LIMIT,
} as const;

export function renderNotFound(slug: string): string {
  return render(NOT_FOUND, slug);
}

export function renderGone(slug: string): string {
  return render(GONE, slug);
}

export function renderUnavailable(slug: string): string {
  return render(UNAVAILABLE, slug);
}

export function renderLinkLimit(slug: string): string {
  return render(LINK_LIMIT, slug);
}

export function renderBusy(slug: string): string {
  return render(BUSY, slug);
}

/** `path` is the requested path, slug or not, as the not found page shows it. */
export function renderAttemptLimit(path: string): string {
  return render(ATTEMPT_LIMIT, path);
}

const v = tokenValue;

/**
 * The notice layout differs from the other visitor pages: a wider card, the
 * slug on one baseline, an inset well with the destination, and a flat
 * promotion card below. Blue marks a neutral external notice.
 *
 * This page carries more structure than the others, so its stylesheet trades
 * the :root block for token values written in place. A hex value is shorter
 * than var(--name), and a shadow used once costs its value either way. Every
 * value still comes from shared/tokens.ts. Sizes that barely differ between
 * the desktop and the 360px frame use the desktop value, and clamp() is kept
 * only where the difference shows.
 */
const NOTICE_CSS = [
  '*{box-sizing:border-box}',
  'body,main,aside,.d{display:flex;flex-direction:column}',
  `body{margin:0;min-height:100vh;align-items:center;justify-content:center;gap:24px;padding:clamp(20px,5vw,40px) clamp(16px,4vw,32px);background:${v('--bg')};color:${v('--ink')};font-family:${v('--font-system')}}`,
  'main,aside{width:100%;max-width:480px}',
  `main{border-radius:16px;box-shadow:${v('--raise-lg')};padding:clamp(24px,6vw,32px) clamp(20px,5vw,28px);gap:22px}`,
  `.b{align-self:flex-end;font-size:12px;letter-spacing:.14em;padding:6px 9px;border-radius:4px;background:${v('--link')};color:${v('--sh-l')};box-shadow:${v('--badge-in')}}`,
  '.t,.d,.k,aside{border-radius:12px}',
  '.b,strong,.k{font-weight:800}',
  '.b,h2,.t i,small{line-height:1}',
  '.t i,p,.k{font-size:16px}',
  `.t{display:flex;flex-wrap:wrap;align-items:baseline;gap:2px;padding:18px 20px;background:linear-gradient(145deg,${v('--tile-hi')},${v('--tile-lo')});box-shadow:${v('--tile-in')}}`,
  `.t,code,small{font-family:${v('--mono-system')}}`,
  `.t i{font-style:normal;font-weight:500;color:${v('--tile-prefix')}}`,
  `.t b{font-size:clamp(26px,7vw,30px);line-height:1.1;color:${v('--sign')}}`,
  '.t b,strong,code{overflow-wrap:anywhere}',
  'h2,p{margin:0}',
  'p{line-height:1.55}',
  `.d{gap:8px;padding:16px;border:1px solid ${v('--line')};box-shadow:${v('--inset')}}`,
  'h2{font-size:11px;letter-spacing:.16em}',
  `h2,code,aside p,small{color:${v('--ink2')}}`,
  'strong{font-size:clamp(24px,6vw,30px);line-height:1.15}',
  'code{font-size:13px;line-height:1.5}',
  `.k{display:grid;place-items:center;min-height:52px;padding:0 14px;border:1px solid;background:${v('--sign')};color:${v('--ink')};line-height:1.2;text-decoration:none;box-shadow:${v('--raise-sm')}}`,
  `aside{gap:6px;padding:16px 20px;border:1px solid ${v('--hair')}}`,
  'aside p{font-size:14px}',
  `aside a{font-weight:700;color:${v('--link')}}`,
  'small{font-weight:500;font-size:12px;letter-spacing:.06em}',
  `a:focus-visible{outline:3px solid ${v('--link')};outline-offset:3px}`,
].join('');

/**
 * The host shown large in the destination well, without a leading www, as in
 * the design. Internationalized names stay in their punycode form, so a look
 * alike name cannot pass for a familiar one.
 */
function displayHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return hostOf(url);
  }
}

/**
 * The notice a public link shows before its destination. Continue is a plain
 * link to the stored URL, so the page needs no JavaScript and the click needs
 * no second request to daffa.me.
 */
export function renderInterstitial(slug: string, url: string): string {
  const href = escapeHtml(url);
  return [
    '<!doctype html>',
    '<html lang="en"><head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    '<meta name="robots" content="noindex">',
    '<title>External link · daffa.me</title>',
    `<style>${NOTICE_CSS}</style>`,
    '</head><body>',
    '<main>',
    '<span class="b">EXTERNAL LINK</span>',
    `<div class="t"><i>daffa.me/</i><b>${escapeHtml(slug)}</b></div>`,
    '<p>This short link leads to an external site that is not operated by daffa.me. Check the destination before continuing.</p>',
    `<div class="d"><h2>DESTINATION</h2><strong>${escapeHtml(displayHost(url))}</strong><code>${href}</code></div>`,
    `<a class="k" href="${href}" rel="nofollow noopener">Continue to destination</a>`,
    '</main>',
    '<aside><h2>BUILT BY</h2>',
    `<p>This shortener is built by Daffa Ilham Restupratama. The portfolio and other projects are available at <a href="${HOME}">daffarestupratama.com</a>.</p>`,
    '</aside>',
    '<small>PUBLIC LINK NOTICE</small>',
    '</body></html>',
  ].join('');
}

/**
 * A visitor page never caches: a slug that is missing today may exist tomorrow,
 * an expired link may be reactivated, and a public link limit resets daily.
 */
export function pageResponse(
  html: string,
  status: number,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(html, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store, private',
      ...extraHeaders,
    },
  });
}

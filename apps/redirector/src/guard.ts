import { hmacTag, rateLimitSubject } from '@daffa/shared';

/**
 * The slug guessing guard. Guessing slugs is the only way to find private
 * links, so the redirector counts misses, never hits: a request that ends in
 * the 404 page. Once one network makes more than MISS_LIMIT misses inside the
 * binding's window, every request from it gets the 429 attempt limit page for
 * MISS_WINDOW_SECONDS, valid slugs included.
 *
 * Nothing here writes to D1, and the raw address goes nowhere. The subject
 * (an IPv4 address or an IPv6 /64, shared/ip.ts) becomes an HMAC with
 * RATE_LIMIT_SECRET before it reaches the Rate Limiting binding or the cache.
 *
 * Two layers tell whether a key is blocked:
 *   1. a map in this isolate's memory, free and instant;
 *   2. a marker in the Cache API of this data center, which every isolate here
 *      can see. The caller runs this lookup in parallel with the D1 slug lookup,
 *      so a hit gains no latency from it.
 * Rate Limiting counters are per Cloudflare location too, so both layers have
 * the same reach as the counter that feeds them.
 *
 * Every failure fails open: a missing secret, a binding error, or a cache
 * error never stops a visitor. Each kind of failure is logged once per isolate.
 */

/** Must equal ratelimits[0].simple in wrangler.jsonc. guard.test.ts checks it. */
export const MISS_LIMIT = 10;
export const MISS_WINDOW_SECONDS = 60;

export interface GuardEnv {
  MISS_LIMITER?: RateLimit;
  RATE_LIMIT_SECRET?: string;
}

/**
 * Paths that browsers and crawlers request on their own. Safari asks for the
 * touch icons on every page it shows, the 404 and notice pages included, so
 * counting them would charge real visitors with misses. None of them can be a
 * slug, so they tell a guesser nothing.
 */
const AUTO_PATH =
  /^\/(?:apple-touch-icon[\w.-]*\.png|\.well-known\/.*|sitemap\.xml|ads\.txt|app-ads\.txt|site\.webmanifest|manifest\.json|browserconfig\.xml)$/i;

export function isAutoPath(pathname: string): boolean {
  return AUTO_PATH.test(pathname);
}

const reported = new Set<string>();

/** Logs a failure of one kind at most once per isolate, so a broken binding cannot flood the logs. */
function reportOnce(kind: string, error?: unknown): void {
  if (reported.has(kind)) return;
  reported.add(kind);
  console.error(`slug guard: ${kind}, failing open`, error ?? '');
}

/**
 * The guard key of a request, or null when the guard is off because
 * RATE_LIMIT_SECRET is not set.
 */
export async function guardKey(env: GuardEnv, request: Request): Promise<string | null> {
  const secret = env.RATE_LIMIT_SECRET?.trim();
  if (!secret) {
    reportOnce('RATE_LIMIT_SECRET is not set');
    return null;
  }
  return `miss:${await hmacTag(secret, rateLimitSubject(request.headers.get('cf-connecting-ip')))}`;
}

// Layer 1. Bounded, so a flood of keys cannot grow the isolate's memory.
const MEMORY_LIMIT = 1000;
const memory = new Map<string, number>();

function remember(key: string, until: number): void {
  if (memory.size >= MEMORY_LIMIT) {
    const oldest = memory.keys().next().value;
    if (oldest !== undefined) memory.delete(oldest);
  }
  memory.set(key, until);
}

/** The block end in this isolate's memory, without any lookup. */
export function blockedInMemory(key: string, now: number): number | null {
  const until = memory.get(key);
  if (until === undefined) return null;
  if (until > now) return until;
  memory.delete(key);
  return null;
}

/** Test helper: forget every remembered block and logged failure. */
export function resetGuardMemory(): void {
  memory.clear();
  reported.clear();
}

// Layer 2. The marker URL is never served: daffa.me routes every request to
// this Worker, and the Cache API is a separate store keyed by URL.
const markerUrl = (key: string) => `https://daffa.me/__guard/${encodeURIComponent(key)}`;
const UNTIL_HEADER = 'X-Blocked-Until';

/** The block end from the marker of this data center, or null. Never throws. */
export async function blockedInCache(key: string, now: number, cache: Cache | null): Promise<number | null> {
  if (!cache) return null;
  try {
    const marker = await cache.match(markerUrl(key));
    const until = Number(marker?.headers.get(UNTIL_HEADER));
    if (!Number.isFinite(until) || until <= now) return null;
    remember(key, until);
    return until;
  } catch (error) {
    reportOnce('cache lookup failed', error);
    return null;
  }
}

interface WaitUntil {
  waitUntil(promise: Promise<unknown>): void;
}

/**
 * Counts one miss. Returns when the block ends if this miss went over the
 * limit, else null, also when the binding is missing or fails.
 */
export async function recordMiss(
  env: GuardEnv,
  key: string,
  now: number,
  cache: Cache | null,
  ctx: WaitUntil,
): Promise<number | null> {
  if (!env.MISS_LIMITER) {
    reportOnce('MISS_LIMITER binding is missing');
    return null;
  }
  let success: boolean;
  try {
    ({ success } = await env.MISS_LIMITER.limit({ key }));
  } catch (error) {
    reportOnce('rate limit call failed', error);
    return null;
  }
  if (success) return null;

  const until = now + MISS_WINDOW_SECONDS * 1000;
  remember(key, until);
  if (cache) {
    const marker = new Response(null, {
      headers: { 'Cache-Control': `max-age=${MISS_WINDOW_SECONDS}`, [UNTIL_HEADER]: String(until) },
    });
    ctx.waitUntil(
      cache.put(markerUrl(key), marker).catch((error: unknown) => reportOnce('cache write failed', error)),
    );
  }
  return until;
}

/** caches.default where the runtime has it, null elsewhere (unit tests pass their own). */
export function defaultCache(): Cache | null {
  return typeof caches === 'undefined' ? null : caches.default;
}

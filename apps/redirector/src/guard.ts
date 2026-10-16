import { hmacTag, rateLimitSubject } from '@daffa/shared';
import { UPSERT_GUARD_BLOCK } from './sql';

/**
 * The slug guessing guard. Guessing slugs is the only way to find private
 * links, so the redirector counts misses, never hits: a request that ends in
 * the 404 page. Once one network makes more than MISS_LIMIT misses inside
 * MISS_WINDOW_SECONDS, every request from it gets the 429 attempt limit page,
 * valid slugs included.
 *
 * The raw address goes nowhere. The subject (an IPv4 address or an IPv6 /64,
 * shared/ip.ts) becomes an HMAC with RATE_LIMIT_SECRET before it reaches the
 * Rate Limiting binding, the cache, or D1.
 *
 * Two detectors count misses, and whichever goes over first trips the guard:
 *   1. a counter in this isolate's memory, which sees a parallel burst at once,
 *      since it counts before anything is awaited;
 *   2. the Rate Limiting binding, shared by the isolates of one location but
 *      eventually consistent, so it catches paced misses spread over isolates.
 *
 * Three layers tell whether a key is blocked:
 *   1. a map in this isolate's memory, free and instant;
 *   2. a marker in the Cache API of this data center, which every isolate here
 *      can see, for MISS_WINDOW_SECONDS;
 *   3. a row in the D1 table guard_blocks, which every location sees, for
 *      GLOBAL_BLOCK_SECONDS. The slug lookup reads it in the same query, so it
 *      costs no round trip. Paths that skip the lookup never see it, which is
 *      fine: they can never reveal a slug.
 * The caller runs the cache lookup in parallel with the D1 slug lookup, so a
 * hit gains no latency from either.
 *
 * A trip writes the D1 row once per key per isolate per GLOBAL_BLOCK_SECONDS,
 * in waitUntil, so a guesser cannot turn misses into D1 writes.
 *
 * Every failure fails open: a missing secret, a binding error, a cache error,
 * or a D1 error never stops a visitor. Each kind of failure is logged once per
 * isolate.
 */

/** Must equal ratelimits[0].simple in wrangler.jsonc. guard.test.ts checks it. */
export const MISS_LIMIT = 10;
export const MISS_WINDOW_SECONDS = 60;
/** How long a trip blocks the network at every location, through guard_blocks. */
export const GLOBAL_BLOCK_SECONDS = 300;

export interface GuardEnv {
  MISS_LIMITER?: RateLimit;
  RATE_LIMIT_SECRET?: string;
  DB?: D1Database;
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
export function reportOnce(kind: string, error?: unknown): void {
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

// Every map below is bounded, so a flood of keys cannot grow the isolate's memory.
const MEMORY_LIMIT = 1000;

function boundedSet<V>(map: Map<string, V>, key: string, value: V): void {
  if (!map.has(key) && map.size >= MEMORY_LIMIT) {
    const oldest = map.keys().next().value;
    if (oldest !== undefined) map.delete(oldest);
  }
  map.set(key, value);
}

// Layer 1: when the block of a key ends.
const memory = new Map<string, number>();

/** Keeps the later end, so a short local block never cuts a global one short. */
function remember(key: string, until: number): void {
  boundedSet(memory, key, Math.max(until, memory.get(key) ?? 0));
}

/** The block end in this isolate's memory, without any lookup. */
export function blockedInMemory(key: string, now: number): number | null {
  const until = memory.get(key);
  if (until === undefined) return null;
  if (until > now) return until;
  memory.delete(key);
  return null;
}

// Detector 1: misses per key in a fixed window that starts at the first miss.
const localMisses = new Map<string, { start: number; count: number }>();

/** Counts one miss and returns the count inside the current window. */
function countLocalMiss(key: string, now: number): number {
  const entry = localMisses.get(key);
  if (entry && now - entry.start < MISS_WINDOW_SECONDS * 1000) {
    entry.count += 1;
    return entry.count;
  }
  boundedSet(localMisses, key, { start: now, count: 1 });
  return 1;
}

// Layer 3: keys whose global block this isolate wrote or saw, and until when.
const announced = new Map<string, number>();

/**
 * A global block that the slug lookup reported. Remembered, so later requests
 * from that network in this isolate are answered before D1, and announced, so
 * this isolate never writes the row again while it lasts.
 */
export function noteGlobalBlock(key: string, until: number): void {
  remember(key, until);
  boundedSet(announced, key, Math.max(until, announced.get(key) ?? 0));
}

/** Test helper: forget every remembered block, counted miss, and logged failure. */
export function resetGuardMemory(): void {
  memory.clear();
  localMisses.clear();
  announced.clear();
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
 * limit, else null. A missing or failing binding leaves the local counter
 * working on its own.
 */
export async function recordMiss(
  env: GuardEnv,
  key: string,
  now: number,
  cache: Cache | null,
  ctx: WaitUntil,
): Promise<number | null> {
  // Counted before any await, so parallel misses in this isolate see each other.
  if (countLocalMiss(key, now) > MISS_LIMIT) return trip(env, key, now, cache, ctx);

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
  return success ? null : trip(env, key, now, cache, ctx);
}

/**
 * Blocks the key here for MISS_WINDOW_SECONDS and at every location for
 * GLOBAL_BLOCK_SECONDS. Returns the end that valid slugs will see.
 */
function trip(env: GuardEnv, key: string, now: number, cache: Cache | null, ctx: WaitUntil): number {
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

  if (!env.DB) return until;
  const globalUntil = now + GLOBAL_BLOCK_SECONDS * 1000;
  // Marked before the write starts, so parallel trips in this isolate write once.
  if ((announced.get(key) ?? 0) <= now) {
    boundedSet(announced, key, globalUntil);
    ctx.waitUntil(
      env.DB.prepare(UPSERT_GUARD_BLOCK)
        .bind(key, globalUntil)
        .run()
        .catch((error: unknown) => reportOnce('global block write failed', error)),
    );
  }
  return globalUntil;
}

/** caches.default where the runtime has it, null elsewhere (unit tests pass their own). */
export function defaultCache(): Cache | null {
  return typeof caches === 'undefined' ? null : caches.default;
}

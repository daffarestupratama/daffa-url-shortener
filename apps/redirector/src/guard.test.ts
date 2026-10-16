import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hmacTag, rateLimitSubject } from '@daffa/shared';
import { GLOBAL_BLOCK_SECONDS, MISS_LIMIT, MISS_WINDOW_SECONDS, resetGuardMemory } from './guard';
import app, { type Env } from './index';
import { LOOKUP, UPSERT_GUARD_BLOCK } from './sql';
import wranglerConfig from '../wrangler.jsonc?raw';

const NOW = Date.UTC(2026, 9, 5, 7, 0, 0);
const DAY = Date.UTC(2026, 9, 5);
const IP = '203.0.113.7';
const SECRET = 'test-secret';

interface Row {
  id: number;
  url: string;
  is_active: number;
  expires_at: number | null;
  is_public: number;
  click_day: number;
  click_today: number;
  budget_used: number | null;
}

const PRIVATE: Row = { id: 1, url: 'https://example.com/cv', is_active: 1, expires_at: null, is_public: 0, click_day: 0, click_today: 0, budget_used: null };
const INACTIVE: Row = { ...PRIVATE, id: 2, is_active: 0 };
const PUBLIC: Row = { ...PRIVATE, id: 3, is_public: 1, click_day: DAY, click_today: 3, budget_used: 10 };
const CAPPED: Row = { ...PUBLIC, id: 4, click_today: 500 };

/** What LOOKUP returns for an unknown slug: the constant row with every link column NULL. */
const NO_LINK = { id: null, url: null, is_active: null, expires_at: null, is_public: null, click_day: null, click_today: null, budget_used: null };

interface DbOptions {
  /** Every lookup throws, the way D1 does when it is unreachable. */
  fail?: boolean;
  /** LOOKUP throws as it does before migration 0003. The unguarded lookup still works. */
  noTable?: boolean;
  /** The guard_blocks upsert throws. */
  writeFails?: boolean;
}

/**
 * A D1 stand in. LOOKUP answers from `rows` and `blocks` the way the SQL does:
 * always one row, blocked_until only while the block lasts. The unguarded
 * lookup answers from `rows` alone. Upserts land in `blocks` and `upserts`,
 * every other write is recorded in `writes`.
 */
function fakeDb(rows: Record<string, Row>, options: DbOptions = {}) {
  const writes: string[] = [];
  const upserts: unknown[][] = [];
  const lookupArgs: unknown[][] = [];
  const blocks = new Map<string, number>();
  const statement = (sql: string) => ({
    bind: (...args: unknown[]) => ({
      first: async () => {
        lookupArgs.push(args);
        if (options.fail) throw new Error('D1_ERROR: offline');
        const row = rows[String(args[0])];
        if (sql !== LOOKUP) return row ?? null;
        if (options.noTable) throw new Error('D1_ERROR: no such table: guard_blocks: SQLITE_ERROR');
        const until = args[2] === null ? undefined : blocks.get(String(args[2]));
        return { ...(row ?? NO_LINK), blocked_until: until !== undefined && until > Number(args[3]) ? until : null };
      },
      run: async () => {
        if (sql === UPSERT_GUARD_BLOCK) {
          if (options.writeFails) throw new Error('D1_ERROR: database is locked');
          upserts.push(args);
          const [key, until] = args as [string, number];
          blocks.set(key, Math.max(until, blocks.get(key) ?? 0));
          return {};
        }
        writes.push(sql);
        return {};
      },
      sql,
    }),
  });
  const db = {
    prepare: statement,
    batch: async (list: Array<{ sql: string }>) => {
      for (const item of list) writes.push(item.sql);
      return [];
    },
  };
  return { db: db as unknown as D1Database, writes, upserts, blocks, lookupArgs, lookups: () => lookupArgs.length };
}

/** The Rate Limiting binding: allows `limit` calls per key, records every key, can throw. */
function fakeLimiter(limit = MISS_LIMIT, fail = false) {
  const counts = new Map<string, number>();
  const keys: string[] = [];
  const binding = {
    limit: async ({ key }: { key: string }) => {
      if (fail) throw new Error('rate limiter unavailable');
      keys.push(key);
      const next = (counts.get(key) ?? 0) + 1;
      counts.set(key, next);
      return { success: next <= limit };
    },
  };
  return { binding: binding as unknown as RateLimit, keys, calls: () => keys.length };
}

/** caches.default as a Map keyed by URL, honoring nothing but presence. */
function fakeCache(fail = false) {
  const store = new Map<string, Response>();
  const cache = {
    match: async (url: string) => {
      if (fail) throw new Error('cache down');
      return store.get(url)?.clone();
    },
    put: async (url: string, response: Response) => {
      if (fail) throw new Error('cache down');
      store.set(url, response);
    },
  };
  return { cache, store };
}

interface Setup extends DbOptions {
  rows?: Record<string, Row>;
  limiter?: ReturnType<typeof fakeLimiter>;
  cacheFails?: boolean;
  dbFails?: boolean;
  secret?: string | undefined;
}

function setup(options: Setup = {}) {
  const db = fakeDb(options.rows ?? { cv: PRIVATE, old: INACTIVE, x7kq2m: PUBLIC, r9pd3v: CAPPED }, {
    fail: options.dbFails,
    noTable: options.noTable,
    writeFails: options.writeFails,
  });
  const limiter = options.limiter ?? fakeLimiter();
  const { cache, store } = fakeCache(options.cacheFails);
  vi.stubGlobal('caches', { default: cache });
  const env: Env = {
    DB: db.db,
    MISS_LIMITER: limiter.binding,
    RATE_LIMIT_SECRET: 'secret' in options ? options.secret : SECRET,
  };
  const pending: Promise<unknown>[] = [];
  const ctx = { waitUntil: (promise: Promise<unknown>) => void pending.push(promise), passThroughOnException: () => {} };

  const request = async (pathname: string, ip = IP, method = 'GET') => {
    const response = await app.fetch(
      new Request(`https://daffa.me${pathname}`, { method, headers: { 'CF-Connecting-IP': ip } }),
      env,
      ctx as unknown as ExecutionContext,
    );
    await Promise.all(pending.splice(0));
    return response;
  };
  return { request, db, limiter, store };
}

/** The guard key of an address, as guard.ts derives it. */
const keyOf = async (ip = IP) => `miss:${await hmacTag(SECRET, rateLimitSubject(ip))}`;

/** A guesser that never trips the binding, as the eventually consistent binding behaved in production. */
const lenientLimiter = () => fakeLimiter(Number.POSITIVE_INFINITY);

beforeEach(() => {
  resetGuardMemory();
  vi.useFakeTimers({ now: NOW, toFake: ['Date'] });
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Spends exactly MISS_LIMIT misses, all of which still answer 404. */
async function spendMisses(request: ReturnType<typeof setup>['request'], ip?: string) {
  for (let i = 0; i < MISS_LIMIT; i += 1) {
    const response = await request(i % 2 ? `/nope-${i}` : `/wp-login-${i}.php`, ip);
    expect(response.status).toBe(404);
  }
}

/** Misses on paths that skip the lookup, so they see the local layers only. */
async function junkMisses(request: ReturnType<typeof setup>['request'], count: number) {
  const statuses: number[] = [];
  for (let i = 0; i < count; i += 1) statuses.push((await request(`/wp-login-${i}.php`)).status);
  return statuses;
}

/** Messages of the console.error calls the guard made. */
const guardLogs = () =>
  vi.mocked(console.error).mock.calls.map((call) => String(call[0])).filter((message) => message.startsWith('slug guard'));

describe('what counts as a miss', () => {
  it('counts unknown slugs and paths that cannot be slugs', async () => {
    const { request, limiter } = setup();
    expect((await request('/does-not-exist')).status).toBe(404);
    expect((await request('/wp-admin/setup.php')).status).toBe(404);
    expect(limiter.calls()).toBe(2);
  });

  it('never counts hits, 410s, daily caps, lookup failures, or HEAD hits', async () => {
    const { request, limiter } = setup();
    expect((await request('/cv')).status).toBe(302);
    expect((await request('/cv', undefined, 'HEAD')).status).toBe(302);
    expect((await request('/x7kq2m')).status).toBe(200);
    expect((await request('/r9pd3v')).status).toBe(429);
    expect((await request('/old')).status).toBe(410);
    expect(limiter.calls()).toBe(0);

    const failing = setup({ dbFails: true });
    expect((await failing.request('/cv')).status).toBe(503);
    expect(failing.limiter.calls()).toBe(0);
  });

  it('never counts or blocks the apex, icons, robots, automatic paths, or other methods', async () => {
    const { request, limiter } = setup();
    expect((await request('/')).status).toBe(301);
    for (const icon of ['/favicon.ico', '/apple-touch-icon.png', '/apple-touch-icon-precomposed.png']) {
      expect((await request(icon)).status, icon).toBe(200);
    }
    expect((await request('/robots.txt')).status).toBe(200);
    for (const auto of ['/apple-touch-icon-120x120.png', '/apple-touch-icon-152x152-precomposed.png', '/.well-known/security.txt', '/sitemap.xml', '/ads.txt']) {
      expect((await request(auto)).status, auto).toBe(404);
    }
    expect((await request('/cv', undefined, 'POST')).status).toBe(405);
    expect(limiter.calls()).toBe(0);
  });
});

describe('blocking', () => {
  it('answers the miss over the limit with the attempt limit page, then blocks every request', async () => {
    const { request, db, store } = setup();
    await spendMisses(request);
    const over = await request('/one-more');
    expect(over.status).toBe(429);
    expect(over.headers.get('Retry-After')).toBe(String(GLOBAL_BLOCK_SECONDS));
    expect(over.headers.get('Cache-Control')).toBe('no-store, private');
    expect(await over.text()).toContain('Too many unknown links');
    expect(store.size).toBe(1);

    // Hits are blocked too, before anything is logged or counted.
    const writesBefore = db.writes.length;
    expect((await request('/cv')).status).toBe(429);
    expect((await request('/cv', undefined, 'HEAD')).status).toBe(429);
    expect((await request('/x7kq2m')).status).toBe(429);
    expect(db.writes.length).toBe(writesBefore);

    // The apex, the icons and robots stay open.
    expect((await request('/favicon.ico')).status).toBe(200);
    expect((await request('/apple-touch-icon.png')).status).toBe(200);
    expect((await request('/')).status).toBe(301);
    expect((await request('/robots.txt')).status).toBe(200);
  });

  it('blocks from the cache marker in another isolate for the local window, and from the global row after it', async () => {
    const { request, store } = setup();
    await spendMisses(request);
    await request('/one-more');
    expect(store.size).toBe(1);

    // A fresh isolate has an empty memory but sees the marker of the data
    // center. A junk path never reaches the lookup, so the marker alone counts.
    resetGuardMemory();
    vi.setSystemTime(NOW + 20_000);
    const junk = await request('/wp-login.php');
    expect(junk.status).toBe(429);
    expect(junk.headers.get('Retry-After')).toBe(String(MISS_WINDOW_SECONDS - 20));

    // A valid slug also reads the global row, which lasts longer.
    resetGuardMemory();
    const slug = await request('/cv');
    expect(slug.status).toBe(429);
    expect(slug.headers.get('Retry-After')).toBe(String(GLOBAL_BLOCK_SECONDS - 20));

    resetGuardMemory();
    vi.setSystemTime(NOW + MISS_WINDOW_SECONDS * 1000);
    expect((await request('/cv')).status).toBe(429);

    resetGuardMemory();
    vi.setSystemTime(NOW + GLOBAL_BLOCK_SECONDS * 1000);
    expect((await request('/cv')).status).toBe(302);
  });

  it('leaves other networks alone and treats one IPv6 /64 as one network', async () => {
    const { request } = setup();
    await spendMisses(request, '2001:db8:1:2::a');
    expect((await request('/one-more', '2001:db8:1:2:ffff::b')).status).toBe(429);
    expect((await request('/cv', '2001:db8:1:3::a')).status).toBe(302);
    expect((await request('/cv', '203.0.113.8')).status).toBe(302);
  });

  it('never lets hits alone trigger a block or write a global row', async () => {
    const { request, limiter, db } = setup();
    for (let i = 0; i < 50; i += 1) expect((await request('/cv')).status).toBe(302);
    expect(limiter.calls()).toBe(0);
    expect((await request('/unknown')).status).toBe(404);
    expect(db.upserts).toHaveLength(0);
  });
});

describe('local burst counter', () => {
  it('trips on a parallel burst even when the binding lets every miss through', async () => {
    const { request, limiter, db } = setup({ limiter: lenientLimiter() });
    const burst = await Promise.all(
      Array.from({ length: MISS_LIMIT + 1 }, (_, i) => request(i % 2 ? `/nope-${i}` : `/wp-login-${i}.php`)),
    );
    const statuses = burst.map((response) => response.status);
    expect(statuses.filter((status) => status === 404)).toHaveLength(MISS_LIMIT);
    expect(statuses.filter((status) => status === 429)).toHaveLength(1);
    expect(burst.find((response) => response.status === 429)?.headers.get('Retry-After')).toBe(String(GLOBAL_BLOCK_SECONDS));
    // The miss over the limit trips in memory and never asks the binding.
    expect(limiter.calls()).toBe(MISS_LIMIT);
    expect(db.upserts).toEqual([[await keyOf(), NOW + GLOBAL_BLOCK_SECONDS * 1000]]);
    expect((await request('/cv')).status).toBe(429);
  });

  it('starts a new window once the old one has passed', async () => {
    const { request } = setup({ limiter: lenientLimiter() });
    expect(await junkMisses(request, MISS_LIMIT)).not.toContain(429);
    vi.setSystemTime(NOW + MISS_WINDOW_SECONDS * 1000);
    expect(await junkMisses(request, MISS_LIMIT)).not.toContain(429);
    expect((await request('/wp-login.php')).status).toBe(429);
  });

  it('keeps counting in memory when the binding throws or is missing', async () => {
    const throwing = setup({ limiter: fakeLimiter(MISS_LIMIT, true) });
    await spendMisses(throwing.request);
    expect((await throwing.request('/one-more')).status).toBe(429);

    resetGuardMemory();
    const missing = setup();
    const env = { DB: missing.db.db, RATE_LIMIT_SECRET: SECRET } as Env;
    const ctx = { waitUntil: () => {}, passThroughOnException: () => {} } as unknown as ExecutionContext;
    const fetchPath = (path: string) =>
      app.fetch(new Request(`https://daffa.me${path}`, { headers: { 'CF-Connecting-IP': IP } }), env, ctx);
    for (let i = 0; i < MISS_LIMIT; i += 1) expect((await fetchPath(`/nope-${i}`)).status).toBe(404);
    expect((await fetchPath('/one-more')).status).toBe(429);
    expect(guardLogs()).toContain('slug guard: MISS_LIMITER binding is missing, failing open');
  });
});

describe('global block', () => {
  it('blocks valid and unknown slugs from a global row alone, while junk paths see local layers only', async () => {
    const { request, db, limiter } = setup();
    db.blocks.set(await keyOf(), NOW + 120_000);

    // No local marker exists here, and a junk path never reads D1.
    expect((await request('/wp-login.php')).status).toBe(404);

    const blocked = await request('/cv');
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get('Retry-After')).toBe('120');
    expect(await blocked.text()).toContain('Too many unknown links');
    expect(db.writes).toHaveLength(0);

    // The isolate now remembers the block, so even junk paths stop before D1.
    const lookups = db.lookups();
    expect((await request('/cv', undefined, 'HEAD')).status).toBe(429);
    expect((await request('/x7kq2m')).status).toBe(429);
    expect((await request('/wp-login.php')).status).toBe(429);
    expect(db.lookups()).toBe(lookups);
    expect(limiter.calls()).toBe(1);
  });

  it('reports the block to an unknown slug too, without counting it', async () => {
    const { request, db, limiter } = setup();
    db.blocks.set(await keyOf(), NOW + 120_000);
    expect((await request('/does-not-exist')).status).toBe(429);
    expect(limiter.calls()).toBe(0);
  });

  it('ignores a row whose block has ended', async () => {
    const { request, db } = setup();
    db.blocks.set(await keyOf(), NOW - 1000);
    expect((await request('/cv')).status).toBe(302);
    expect((await request('/does-not-exist')).status).toBe(404);
  });

  it('only affects the network the row belongs to', async () => {
    const { request, db } = setup();
    db.blocks.set(await keyOf('198.51.100.9'), NOW + 120_000);
    expect((await request('/cv')).status).toBe(302);
    expect((await request('/cv', '198.51.100.9')).status).toBe(429);
  });

  it('writes the row once per isolate while the block lasts, and again after it', async () => {
    const { request, db } = setup({ limiter: lenientLimiter() });
    await junkMisses(request, MISS_LIMIT + 1);
    expect(db.upserts).toHaveLength(1);

    // The local block ends after a minute and junk paths trip it again, but
    // the global block still runs, so nothing new is written.
    vi.setSystemTime(NOW + MISS_WINDOW_SECONDS * 1000);
    expect((await junkMisses(request, MISS_LIMIT + 1)).at(-1)).toBe(429);
    expect(db.upserts).toHaveLength(1);

    vi.setSystemTime(NOW + GLOBAL_BLOCK_SECONDS * 1000);
    expect((await junkMisses(request, MISS_LIMIT + 1)).at(-1)).toBe(429);
    expect(db.upserts).toHaveLength(2);
    expect(db.upserts[1]?.[1]).toBe(NOW + 2 * GLOBAL_BLOCK_SECONDS * 1000);
  });

  it('writes no address, only the HMAC key', async () => {
    const { request, db } = setup();
    await spendMisses(request, '198.51.100.23');
    await request('/one-more', '198.51.100.23');
    expect(db.upserts).toHaveLength(1);
    expect(JSON.stringify(db.upserts)).not.toContain('198.51');
    expect(db.upserts[0]?.[0]).toMatch(/^miss:[A-Za-z0-9_-]{43}$/);
  });
});

describe('privacy', () => {
  it('never hands the address itself to the binding or the cache', async () => {
    const { request, limiter, store } = setup();
    await spendMisses(request, '198.51.100.23');
    await request('/one-more', '198.51.100.23');
    for (const value of [...limiter.keys, ...store.keys()]) {
      expect(value).not.toContain('198.51.100.23');
      expect(value).not.toContain('198.51');
    }
    expect(limiter.keys[0]).toMatch(/^miss:[A-Za-z0-9_-]{43}$/);
  });
});

describe('fail open', () => {
  it('serves normally when the cache throws, and still blocks from memory', async () => {
    const { request } = setup({ cacheFails: true });
    expect((await request('/cv')).status).toBe(302);
    await spendMisses(request);
    expect((await request('/one-more')).status).toBe(429);
    expect((await request('/cv')).status).toBe(429);
  });

  it('still answers 429 when the global write fails, and logs it once', async () => {
    const { request } = setup({ writeFails: true, limiter: lenientLimiter() });
    await spendMisses(request);
    expect((await request('/one-more')).status).toBe(429);
    vi.setSystemTime(NOW + GLOBAL_BLOCK_SECONDS * 1000);
    expect((await junkMisses(request, MISS_LIMIT + 1)).at(-1)).toBe(429);
    expect(guardLogs().filter((message) => message.includes('global block write failed'))).toHaveLength(1);
  });

  it('falls back to the lookup without guard_blocks when the table is missing', async () => {
    const { request } = setup({ noTable: true });
    expect((await request('/cv')).status).toBe(302);
    expect((await request('/old')).status).toBe(410);
    expect((await request('/x7kq2m')).status).toBe(200);
    expect((await request('/does-not-exist')).status).toBe(404);
    expect(guardLogs()).toEqual(['slug guard: guard_blocks is missing, run the migrations, failing open']);
  });

  it('turns the guard off without RATE_LIMIT_SECRET, and binds no key', async () => {
    const { request, limiter, db } = setup({ secret: undefined });
    for (let i = 0; i < MISS_LIMIT * 2; i += 1) expect((await request(`/nope-${i}`)).status).toBe(404);
    expect(limiter.calls()).toBe(0);
    expect((await request('/cv')).status).toBe(302);
    expect(db.lookupArgs.every((args) => args[2] === null)).toBe(true);
    expect(db.upserts).toHaveLength(0);
  });
});

describe('configuration', () => {
  it('wrangler.jsonc carries the same limit and period as guard.ts', () => {
    const json = JSON.parse(wranglerConfig.replace(/^\s*\/\/.*$/gm, '')) as {
      ratelimits: Array<{ name: string; simple: { limit: number; period: number } }>;
    };
    const binding = json.ratelimits.find((entry) => entry.name === 'MISS_LIMITER');
    expect(binding?.simple).toEqual({ limit: MISS_LIMIT, period: MISS_WINDOW_SECONDS });
  });
});

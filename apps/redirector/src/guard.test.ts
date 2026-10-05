import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MISS_LIMIT, MISS_WINDOW_SECONDS, resetGuardMemory } from './guard';
import app, { type Env } from './index';
import wranglerConfig from '../wrangler.jsonc?raw';

const NOW = Date.UTC(2026, 9, 5, 7, 0, 0);
const DAY = Date.UTC(2026, 9, 5);

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

/** A D1 stand in: lookups answer from `rows`, writes are recorded. `fail` makes lookups throw. */
function fakeDb(rows: Record<string, Row>, fail = false) {
  const writes: string[] = [];
  let lookups = 0;
  const statement = (sql: string) => ({
    bind: (...args: unknown[]) => ({
      first: async () => {
        lookups += 1;
        if (fail) throw new Error('D1_ERROR: offline');
        return rows[String(args[0])] ?? null;
      },
      run: async () => {
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
  return { db: db as unknown as D1Database, writes, lookups: () => lookups };
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

interface Setup {
  rows?: Record<string, Row>;
  limiter?: ReturnType<typeof fakeLimiter>;
  cacheFails?: boolean;
  dbFails?: boolean;
  secret?: string | undefined;
}

function setup(options: Setup = {}) {
  const db = fakeDb(options.rows ?? { cv: PRIVATE, old: INACTIVE, x7kq2m: PUBLIC, r9pd3v: CAPPED }, options.dbFails);
  const limiter = options.limiter ?? fakeLimiter();
  const { cache, store } = fakeCache(options.cacheFails);
  vi.stubGlobal('caches', { default: cache });
  const env: Env = {
    DB: db.db,
    MISS_LIMITER: limiter.binding,
    RATE_LIMIT_SECRET: 'secret' in options ? options.secret : 'test-secret',
  };
  const pending: Promise<unknown>[] = [];
  const ctx = { waitUntil: (promise: Promise<unknown>) => void pending.push(promise), passThroughOnException: () => {} };

  const request = async (pathname: string, ip = '203.0.113.7', method = 'GET') => {
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

  it('never counts or blocks the apex, favicon, robots, automatic paths, or other methods', async () => {
    const { request, limiter } = setup();
    expect((await request('/')).status).toBe(301);
    expect((await request('/favicon.ico')).status).toBe(204);
    expect((await request('/robots.txt')).status).toBe(200);
    for (const auto of ['/apple-touch-icon.png', '/apple-touch-icon-precomposed.png', '/apple-touch-icon-120x120.png', '/.well-known/security.txt', '/sitemap.xml', '/ads.txt']) {
      expect((await request(auto)).status, auto).toBe(404);
    }
    expect((await request('/cv', undefined, 'POST')).status).toBe(405);
    expect(limiter.calls()).toBe(0);
  });
});

describe('blocking', () => {
  it('answers the miss over the limit with the attempt limit page, then blocks every request for the window', async () => {
    const { request, db, store } = setup();
    await spendMisses(request);
    const over = await request('/one-more');
    expect(over.status).toBe(429);
    expect(over.headers.get('Retry-After')).toBe(String(MISS_WINDOW_SECONDS));
    expect(over.headers.get('Cache-Control')).toBe('no-store, private');
    expect(await over.text()).toContain('Too many unknown links');
    expect(store.size).toBe(1);

    // Hits are blocked too, before anything is logged or counted.
    const writesBefore = db.writes.length;
    expect((await request('/cv')).status).toBe(429);
    expect((await request('/cv', undefined, 'HEAD')).status).toBe(429);
    expect((await request('/x7kq2m')).status).toBe(429);
    expect(db.writes.length).toBe(writesBefore);

    // The apex, favicon and robots stay open.
    expect((await request('/')).status).toBe(301);
    expect((await request('/robots.txt')).status).toBe(200);
  });

  it('blocks from the cache marker in another isolate, with the time left as Retry-After', async () => {
    const { request, store } = setup();
    await spendMisses(request);
    await request('/one-more');
    expect(store.size).toBe(1);

    // A fresh isolate has an empty memory but sees the marker of the data center.
    resetGuardMemory();
    vi.setSystemTime(NOW + 20_000);
    const blocked = await request('/cv');
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get('Retry-After')).toBe('40');

    resetGuardMemory();
    vi.setSystemTime(NOW + MISS_WINDOW_SECONDS * 1000);
    expect((await request('/cv')).status).toBe(302);
  });

  it('leaves other networks alone and treats one IPv6 /64 as one network', async () => {
    const { request } = setup();
    await spendMisses(request, '2001:db8:1:2::a');
    expect((await request('/one-more', '2001:db8:1:2:ffff::b')).status).toBe(429);
    expect((await request('/cv', '2001:db8:1:3::a')).status).toBe(302);
    expect((await request('/cv', '203.0.113.8')).status).toBe(302);
  });

  it('never lets hits alone trigger a block', async () => {
    const { request, limiter } = setup();
    for (let i = 0; i < 50; i += 1) expect((await request('/cv')).status).toBe(302);
    expect(limiter.calls()).toBe(0);
    expect((await request('/unknown')).status).toBe(404);
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
  it('serves normally when the binding throws', async () => {
    const { request } = setup({ limiter: fakeLimiter(MISS_LIMIT, true) });
    for (let i = 0; i < MISS_LIMIT * 2; i += 1) expect((await request(`/nope-${i}`)).status).toBe(404);
    expect((await request('/cv')).status).toBe(302);
  });

  it('serves normally when the cache throws, and still blocks from memory', async () => {
    const { request } = setup({ cacheFails: true });
    expect((await request('/cv')).status).toBe(302);
    await spendMisses(request);
    expect((await request('/one-more')).status).toBe(429);
    expect((await request('/cv')).status).toBe(429);
  });

  it('turns the guard off without RATE_LIMIT_SECRET', async () => {
    const { request, limiter } = setup({ secret: undefined });
    for (let i = 0; i < MISS_LIMIT * 2; i += 1) expect((await request(`/nope-${i}`)).status).toBe(404);
    expect(limiter.calls()).toBe(0);
    expect((await request('/cv')).status).toBe(302);
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

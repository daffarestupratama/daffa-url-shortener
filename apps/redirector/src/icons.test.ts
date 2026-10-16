import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hmacTag, rateLimitSubject } from '@daffa/shared';
import { MISS_LIMIT, resetGuardMemory } from './guard';
import { ICON_CACHE } from './icons';
import app, { type Env } from './index';
import { LOOKUP } from './sql';
import FAVICON_FILE from '../../dashboard/public/favicon.ico?source';
import TOUCH_FILE from '../../dashboard/public/apple-touch-icon.png?source';

const NOW = Date.UTC(2026, 9, 16, 7, 0, 0);
const IP = '203.0.113.7';
const SECRET = 'test-secret';

/**
 * The single source: the files npm run icons writes for the dashboard, read
 * again from disk as separate modules, so they share no buffer with icons.ts.
 */
const FILES: Record<string, ArrayBuffer> = { 'favicon.ico': FAVICON_FILE, 'apple-touch-icon.png': TOUCH_FILE };
const source = (name: string) => new Uint8Array(FILES[name]!);

const CASES = [
  { path: '/favicon.ico', file: 'favicon.ico', type: 'image/x-icon' },
  { path: '/apple-touch-icon.png', file: 'apple-touch-icon.png', type: 'image/png' },
  { path: '/apple-touch-icon-precomposed.png', file: 'apple-touch-icon.png', type: 'image/png' },
];

/**
 * A redirector whose D1 knows no link and holds `blocks`, and whose binding
 * counts every call. `prepared` records every statement, so a test can prove
 * that a path never reached the database.
 */
function setup() {
  const prepared: string[] = [];
  const blocks = new Map<string, number>();
  const db = {
    prepare: (sql: string) => {
      prepared.push(sql);
      return {
        bind: (...args: unknown[]) => ({
          first: async () => {
            if (sql !== LOOKUP) return null;
            const until = blocks.get(String(args[2]));
            return { id: null, blocked_until: until !== undefined && until > Number(args[3]) ? until : null };
          },
          run: async () => ({}),
        }),
      };
    },
  };
  let limiterCalls = 0;
  const limiter = {
    limit: async () => {
      limiterCalls += 1;
      return { success: limiterCalls <= MISS_LIMIT };
    },
  };
  vi.stubGlobal('caches', { default: { match: async () => undefined, put: async () => undefined } });
  const env: Env = { DB: db as unknown as D1Database, MISS_LIMITER: limiter as unknown as RateLimit, RATE_LIMIT_SECRET: SECRET };
  const ctx = { waitUntil: () => {}, passThroughOnException: () => {} } as unknown as ExecutionContext;
  const request = (path: string, ip = IP, method = 'GET') =>
    app.fetch(new Request(`https://daffa.me${path}`, { method, headers: { 'CF-Connecting-IP': ip } }), env, ctx);
  return { request, prepared, blocks, limiterCalls: () => limiterCalls };
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

describe('icons', () => {
  for (const { path, file, type } of CASES) {
    it(`${path} serves ${file} from the dashboard with icon headers`, async () => {
      const { request } = setup();
      const expected = source(file);
      for (let round = 0; round < 2; round += 1) {
        // The second round proves the shared buffer is copied, never detached.
        const response = await request(path);
        expect(response.status).toBe(200);
        expect(response.headers.get('Content-Type')).toBe(type);
        expect(response.headers.get('Content-Length')).toBe(String(expected.byteLength));
        expect(response.headers.get('Cache-Control')).toBe(ICON_CACHE);
        expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
        expect(new Uint8Array(await response.arrayBuffer())).toEqual(expected);
      }
    });

    it(`${path} answers HEAD with the same headers`, async () => {
      const { request } = setup();
      const response = await request(path, IP, 'HEAD');
      expect(response.status).toBe(200);
      expect(response.headers.get('Content-Type')).toBe(type);
      expect(response.headers.get('Content-Length')).toBe(String(source(file).byteLength));
      expect(response.headers.get('Cache-Control')).toBe(ICON_CACHE);
    });
  }

  it('never counts as a miss and never touches D1', async () => {
    const { request, prepared, limiterCalls } = setup();
    for (let i = 0; i < MISS_LIMIT * 3; i += 1) {
      const { path } = CASES[i % CASES.length]!;
      expect((await request(path)).status).toBe(200);
    }
    expect(limiterCalls()).toBe(0);
    expect(prepared).toHaveLength(0);
    expect((await request('/does-not-exist')).status).toBe(404);
  });

  it('stays available to a network blocked by a trip', async () => {
    const { request } = setup();
    for (let i = 0; i < MISS_LIMIT; i += 1) expect((await request(`/nope-${i}`)).status).toBe(404);
    expect((await request('/one-more')).status).toBe(429);
    expect((await request('/does-not-exist')).status).toBe(429);
    for (const { path } of CASES) expect((await request(path)).status, path).toBe(200);
  });

  it('stays available to a network blocked by a global row', async () => {
    const { request, blocks } = setup();
    blocks.set(`miss:${await hmacTag(SECRET, rateLimitSubject(IP))}`, NOW + 120_000);
    expect((await request('/cv')).status).toBe(429);
    for (const { path } of CASES) expect((await request(path, IP, 'HEAD')).status, path).toBe(200);
  });
});

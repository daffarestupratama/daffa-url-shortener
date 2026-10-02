import { hourStart } from '@daffa/shared';
import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';
import { csrfMiddleware } from '../csrf';
import type { AppEnv, Env } from '../env';
import { handleError } from '../errors';
import { BLOCKED_MATCH, PUBLIC_CREATED, PUBLIC_INSERT, RATE_BUMP, RATE_READ } from '../queries';
import { fakeD1 } from '../testing/fakeD1';
import { publicBodyLimit } from '../validate';
import { createPublicRoutes } from './public';

const NOW = Date.UTC(2026, 9, 2, 10, 20, 0);
const WINDOW = hourStart(NOW);
const NEXT_HOUR = WINDOW + 3_600_000;
const PROD = 'https://link.daffa.me';
const DEV = 'http://localhost:5173';
const IP = '203.0.113.7';
const TOKEN = 'XXXX.DUMMY.TOKEN.XXXX';

/** What siteverify answers in production for a good token. */
const PASS = { success: true, hostname: 'link.daffa.me', 'error-codes': [] };
/** What siteverify answers with the always fail test secret, observed on 2 Oct 2026. */
const ALWAYS_FAIL = {
  success: false,
  'error-codes': ['invalid-input-response'],
  messages: [],
  metadata: { result_with_testing_key: true },
};

type Verify = object | number | Error | 'not json';

interface Setup {
  verify?: Verify;
  blocked?: string[];
  ipCount?: number;
  globalCount?: number;
  /** How many inserts fail with a taken slug before one succeeds. */
  conflicts?: number;
  slugs?: string[];
  env?: Partial<Env>;
}

function setup({
  verify = PASS,
  blocked = [],
  ipCount = 0,
  globalCount = 0,
  conflicts = 0,
  slugs = ['bn4tzw', 'r9pd3v', 'h2mc8e'],
  env = {},
}: Setup = {}) {
  const fetcher = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => {
    if (verify instanceof Error) throw verify;
    if (typeof verify === 'number') return new Response('upstream error', { status: verify });
    if (verify === 'not json') return new Response('<html>', { status: 200 });
    return Response.json(verify);
  });

  let remainingConflicts = conflicts;
  let inserted: { slug: string; url: string } | null = null;
  const limited = ipCount >= 5 || globalCount >= 30;
  const d1 = fakeD1((sql, params) => {
    if (sql === BLOCKED_MATCH) {
      const suffixes = JSON.parse(String(params[0])) as string[];
      return { results: suffixes.filter((host) => blocked.includes(host)).map((host) => ({ host })) };
    }
    if (sql === PUBLIC_INSERT) {
      if (remainingConflicts > 0) {
        remainingConflicts -= 1;
        return new Error('D1_ERROR: UNIQUE constraint failed: links.slug: SQLITE_CONSTRAINT');
      }
      inserted = limited ? null : { slug: String(params[0]), url: String(params[1]) };
      return { changes: inserted ? 1 : 0 };
    }
    if (sql === RATE_BUMP) return { changes: inserted ? 2 : 0 };
    if (sql === PUBLIC_CREATED) {
      return inserted ? { results: [{ slug: inserted.slug, url: inserted.url, created_at: params[1] }] } : {};
    }
    if (sql === RATE_READ) {
      return {
        results: [
          { bucket: params[1], count: ipCount },
          { bucket: 'global', count: globalCount },
        ],
      };
    }
    return {};
  });

  const queue = [...slugs];
  const app = new Hono<AppEnv>().basePath('/api');
  app.onError(handleError);
  app.use('/public/*', csrfMiddleware);
  app.use('/public/*', publicBodyLimit);
  app.route(
    '/public',
    createPublicRoutes({ fetcher: fetcher as unknown as typeof fetch, now: () => NOW, randomSlug: () => queue.shift() ?? 'zzzzzz' }),
  );

  async function send(
    body: unknown,
    { base = PROD, origin = base, contentType = 'application/json', dev = false }: { base?: string; origin?: string | null; contentType?: string; dev?: boolean } = {},
  ) {
    const headers: Record<string, string> = { 'Content-Type': contentType, 'CF-Connecting-IP': IP };
    if (origin !== null) headers.Origin = origin;
    const response = await app.request(
      `${base}/api/public/links`,
      { method: 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body) },
      {
        DB: d1.db,
        TURNSTILE_SECRET: 'turnstile-secret',
        RATE_LIMIT_SECRET: 'rate-secret',
        ...(dev ? { DEV_AUTH_BYPASS: 'true' } : {}),
        ...env,
      } satisfies Env,
    );
    const json = (await response.json()) as Record<string, unknown> & {
      error?: { code: string; message: string; resetAt?: number; reason?: string };
    };
    return { status: response.status, headers: response.headers, json, code: json.error?.code };
  }

  /** Statements that touch the hourly counters or create the link. */
  const touchedLimits = () => d1.calls.some((call) => [PUBLIC_INSERT, RATE_BUMP, RATE_READ].includes(call.sql));

  return { send, fetcher, d1, touchedLimits };
}

const valid = { url: 'https://docs.google.com/forms/d/e/1FAIpQLSd3kR9vQx/viewform', slug: 'x7kq2m', turnstileToken: TOKEN };

describe('POST /api/public/links, success', () => {
  it('creates the link and answers with exactly the four result card fields', async () => {
    const { send } = setup();
    const result = await send(valid);
    expect(result.status).toBe(201);
    expect(Object.keys(result.json).sort()).toEqual(['createdAt', 'shortUrl', 'slug', 'url']);
    expect(result.json).toEqual({
      slug: 'x7kq2m',
      shortUrl: 'https://daffa.me/x7kq2m',
      url: valid.url,
      createdAt: NOW,
    });
  });

  it('stores the normalized URL and the host without www as title', async () => {
    const { send, d1 } = setup();
    const result = await send({ ...valid, url: '  WWW.Example.COM/Path?q=1 ' });
    expect(result.json.url).toBe('https://www.example.com/Path?q=1');
    const params = d1.paramsOf(PUBLIC_INSERT);
    expect(params?.slice(0, 5)).toEqual(['x7kq2m', 'https://www.example.com/Path?q=1', 'example.com', NOW, WINDOW]);
    expect(params?.slice(6)).toEqual([5, 30]);
  });

  it('counts the creation in an HMAC bucket and the global bucket, never the raw IP', async () => {
    const { send, d1 } = setup();
    await send(valid);
    const bucket = String(d1.paramsOf(PUBLIC_INSERT)?.[5]);
    expect(bucket).toMatch(/^ip:[A-Za-z0-9_-]{43}$/);
    expect(bucket).not.toContain(IP);
    expect(d1.paramsOf(RATE_BUMP)).toEqual([WINDOW, JSON.stringify([bucket, 'global']), 'x7kq2m', NOW]);
    expect(d1.calls.some((call) => call.params.includes(IP))).toBe(false);
  });

  it('sends the secret, the token and the visitor IP to siteverify', async () => {
    const { send, fetcher } = setup();
    await send(valid);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0] ?? [];
    expect(String(url)).toBe('https://challenges.cloudflare.com/turnstile/v0/siteverify');
    const form = new URLSearchParams(String(init?.body));
    expect(Object.fromEntries(form)).toEqual({ secret: 'turnstile-secret', response: TOKEN, remoteip: IP });
  });

  it('draws a slug on the server when none is sent', async () => {
    const { send } = setup();
    const result = await send({ url: valid.url, turnstileToken: TOKEN });
    expect(result.status).toBe(201);
    expect(result.json.slug).toBe('bn4tzw');
  });

  it('replaces a taken slug with a new random one and returns the final slug', async () => {
    const { send, d1 } = setup({ conflicts: 1 });
    const result = await send(valid);
    expect(result.status).toBe(201);
    expect(result.json.slug).toBe('bn4tzw');
    const slugs = d1.calls.filter((call) => call.sql === PUBLIC_INSERT).map((call) => call.params[0]);
    expect(slugs).toEqual(['x7kq2m', 'bn4tzw']);
  });

  it('gives up after three taken slugs with a 503', async () => {
    const { send, d1 } = setup({ conflicts: 3 });
    const result = await send(valid);
    expect(result.status).toBe(503);
    expect(d1.calls.filter((call) => call.sql === PUBLIC_INSERT)).toHaveLength(3);
  });
});

describe('POST /api/public/links, cheap refusals come before Turnstile and the counters', () => {
  const cases: Array<[string, unknown, number, string, string?]> = [
    ['malformed JSON', '{"url":', 400, 'invalid_json'],
    ['an array body', '[]', 400, 'invalid_field'],
    ['an unknown field', { ...valid, title: 'x' }, 400, 'invalid_field'],
    ['a URL that is not text', { ...valid, url: 42 }, 400, 'invalid_field'],
    ['a token that is not text', { ...valid, turnstileToken: 7 }, 400, 'invalid_field'],
    ['an uppercase slug', { ...valid, slug: 'X7KQ2M' }, 400, 'invalid_slug'],
    ['a short slug', { ...valid, slug: 'x7kq' }, 400, 'invalid_slug'],
    ['a look alike character in the slug', { ...valid, slug: 'x7kq2l' }, 400, 'invalid_slug'],
    ['a reserved word as slug', { ...valid, slug: 'assets' }, 400, 'invalid_slug'],
    ['a missing token', { url: valid.url, slug: 'x7kq2m' }, 403, 'turnstile_failed'],
    ['an empty token', { ...valid, turnstileToken: '' }, 403, 'turnstile_failed'],
    ['an oversized token', { ...valid, turnstileToken: 't'.repeat(2049) }, 403, 'turnstile_failed'],
    ['a missing URL', { slug: 'x7kq2m', turnstileToken: TOKEN }, 400, 'invalid_url', 'required'],
    ['a URL that is too long', { ...valid, url: `https://example.com/${'a'.repeat(2048)}` }, 400, 'invalid_url', 'too_long'],
    ['a script URL', { ...valid, url: 'javascript:alert(1)' }, 400, 'invalid_url', 'invalid'],
    ['a data URL', { ...valid, url: 'data:text/html,x' }, 400, 'invalid_url', 'invalid'],
    ['a host without a dot', { ...valid, url: 'localhost:3000' }, 400, 'invalid_url', 'invalid'],
    ['an IP address', { ...valid, url: 'http://127.0.0.1/admin' }, 400, 'invalid_url', 'ip'],
    ['a daffa.me address', { ...valid, url: 'https://s.daffa.me/x' }, 400, 'invalid_url', 'loop'],
    ['another shortener', { ...valid, url: 'bit.ly/3xYz9Qa' }, 400, 'invalid_url', 'shortener'],
  ];

  for (const [name, body, status, code, reason] of cases) {
    it(`refuses ${name} with ${status} ${code}, without a lookup or siteverify`, async () => {
      const { send, fetcher, d1 } = setup();
      const result = await send(body);
      expect(result.status).toBe(status);
      expect(result.code).toBe(code);
      if (reason) expect(result.json.error?.reason).toBe(reason);
      expect(fetcher).not.toHaveBeenCalled();
      expect(d1.calls).toHaveLength(0);
    });
  }

  it('fails closed when either secret is missing, before reading the body', async () => {
    for (const env of [{ TURNSTILE_SECRET: undefined }, { RATE_LIMIT_SECRET: '  ' }]) {
      const { send, fetcher, d1 } = setup({ env });
      const result = await send('{"url":');
      expect(result.status).toBe(500);
      expect(result.code).toBe('public_not_configured');
      expect(fetcher).not.toHaveBeenCalled();
      expect(d1.calls).toHaveLength(0);
    }
  });

  it('refuses a blocked parent domain after one lookup and before siteverify', async () => {
    const { send, fetcher, d1, touchedLimits } = setup({ blocked: ['example.com'] });
    const result = await send({ ...valid, url: 'https://a.b.example.com/x' });
    expect(result.status).toBe(400);
    expect(result.code).toBe('blocked_domain');
    expect(result.json.error?.message).toBe(
      'The domain a.b.example.com is blocked for public links and cannot be shortened.',
    );
    expect(d1.calls.map((call) => call.sql)).toEqual([BLOCKED_MATCH]);
    expect(JSON.parse(String(d1.paramsOf(BLOCKED_MATCH)?.[0]))).toEqual([
      'a.b.example.com',
      'b.example.com',
      'example.com',
      'com',
    ]);
    expect(fetcher).not.toHaveBeenCalled();
    expect(touchedLimits()).toBe(false);
  });

  it('names a www host without its www', async () => {
    const { send } = setup({ blocked: ['grabgift-promo.com'] });
    const result = await send({ ...valid, url: 'https://www.grabgift-promo.com/klaim' });
    expect(result.json.error?.message).toBe(
      'The domain grabgift-promo.com is blocked for public links and cannot be shortened.',
    );
  });

  it('lets a lookalike of a blocked domain through', async () => {
    const { send } = setup({ blocked: ['example.com'] });
    expect((await send({ ...valid, url: 'https://notexample.com/' })).status).toBe(201);
  });
});

describe('POST /api/public/links, Turnstile', () => {
  const refusals: Array<[string, Verify, number, string]> = [
    ['the always fail secret answer', ALWAYS_FAIL, 403, 'turnstile_failed'],
    ['success on another hostname', { success: true, hostname: 'evil.example' }, 403, 'turnstile_failed'],
    ['success with the test hostname in production', { success: true, hostname: 'example.com' }, 403, 'turnstile_failed'],
    ['success with localhost in production', { success: true, hostname: 'localhost' }, 403, 'turnstile_failed'],
    ['success without a hostname', { success: true }, 403, 'turnstile_failed'],
    ['a 500 from siteverify', 500, 503, 'turnstile_unavailable'],
    ['a body that is not JSON', 'not json', 503, 'turnstile_unavailable'],
    ['a network failure', new TypeError('fetch failed'), 503, 'turnstile_unavailable'],
    ['a timeout', new DOMException('The operation timed out.', 'TimeoutError'), 503, 'turnstile_unavailable'],
  ];

  for (const [name, verify, status, code] of refusals) {
    it(`refuses ${name} with ${status} and never touches the counters`, async () => {
      const { send, touchedLimits } = setup({ verify });
      const result = await send(valid);
      expect(result.status).toBe(status);
      expect(result.code).toBe(code);
      expect(touchedLimits()).toBe(false);
    });
  }

  it('accepts the test secret hostnames only under the local bypass', async () => {
    for (const hostname of ['example.com', 'localhost']) {
      const { send } = setup({ verify: { success: true, hostname } });
      expect((await send(valid, { base: DEV, dev: true })).status, hostname).toBe(201);
    }
    const { send } = setup({ verify: { success: true, hostname: 'link.daffa.me' } });
    expect((await send(valid, { base: DEV, dev: true })).status).toBe(403);
  });

  it('keeps the production rule on the production host even with the flag set', async () => {
    const { send } = setup({ verify: { success: true, hostname: 'example.com' } });
    const result = await send(valid, { dev: true });
    expect(result.status).toBe(403);
    expect(result.code).toBe('turnstile_failed');
  });
});

describe('POST /api/public/links, hourly limits', () => {
  it('refuses the sixth link of a visitor with rate_limited_ip and the next hour', async () => {
    const { send } = setup({ ipCount: 5 });
    const result = await send(valid);
    expect(result.status).toBe(429);
    expect(result.code).toBe('rate_limited_ip');
    expect(result.json.error?.resetAt).toBe(NEXT_HOUR);
    expect(result.headers.get('retry-after')).toBe(String((NEXT_HOUR - NOW) / 1000));
  });

  it('refuses everyone once the global hour is used, with rate_limited_global', async () => {
    const { send } = setup({ ipCount: 1, globalCount: 30 });
    const result = await send(valid);
    expect(result.status).toBe(429);
    expect(result.code).toBe('rate_limited_global');
    expect(result.json.error?.resetAt).toBe(NEXT_HOUR);
  });

  it('names the visitor limit first when both are used up', async () => {
    const { send } = setup({ ipCount: 5, globalCount: 30 });
    expect((await send(valid)).code).toBe('rate_limited_ip');
  });

  it('checks the limits and inserts in one batch, in order', async () => {
    const { send, d1 } = setup();
    await send(valid);
    expect(d1.calls.map((call) => call.sql)).toEqual([BLOCKED_MATCH, PUBLIC_INSERT, RATE_BUMP, PUBLIC_CREATED, RATE_READ]);
  });
});

describe('POST /api/public/links, CSRF and size', () => {
  const csrf: Array<[string, { origin?: string | null; contentType?: string }]> = [
    ['a foreign origin', { origin: 'https://evil.example' }],
    ['the retired dashboard origin', { origin: 'https://shorten.daffa.me' }],
    ['a missing origin', { origin: null }],
    ['a form content type', { contentType: 'application/x-www-form-urlencoded' }],
    ['text/plain', { contentType: 'text/plain' }],
  ];
  for (const [name, options] of csrf) {
    it(`refuses ${name} with 403 csrf_rejected before anything else`, async () => {
      const { send, fetcher, d1 } = setup();
      const result = await send(valid, options);
      expect(result.status).toBe(403);
      expect(result.code).toBe('csrf_rejected');
      expect(fetcher).not.toHaveBeenCalled();
      expect(d1.calls).toHaveLength(0);
    });
  }

  it('accepts the local page origin under the bypass', async () => {
    const { send } = setup({ verify: { success: true, hostname: 'example.com' } });
    expect((await send(valid, { base: DEV, dev: true })).status).toBe(201);
  });

  it('refuses a body over 8 KB with 413', async () => {
    const { send, d1 } = setup();
    const result = await send({ ...valid, url: `https://example.com/${'a'.repeat(9000)}` });
    expect(result.status).toBe(413);
    expect(result.code).toBe('payload_too_large');
    expect(result.json.error?.message).toBe('The request body is larger than 8 KB.');
    expect(d1.calls).toHaveLength(0);
  });
});

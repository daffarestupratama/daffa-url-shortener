import { utcDayStart, type BlockDomainResult, type PrivateLinkList, type PublicLinkList, type Summary } from '@daffa/shared';
import { describe, expect, it } from 'vitest';
import { decodeCursor, encodeCursor } from './cursor';
import type { Env } from './env';
import worker from './index';
import {
  BLOCKED_BY_HOST,
  BLOCKED_DELETE,
  BLOCKED_INSERT,
  BLOCKED_MATCH,
  COUNT_PRIVATE,
  COUNT_PUBLIC,
  DELETE_PUBLIC_LINK,
  DISABLE_IDS,
  LIST_SQL,
  PUBLIC_HOST_CANDIDATES,
  PUBLIC_LINK_BY_ID,
  PUBLIC_SUMMARY,
  SET_PUBLIC_ACTIVE,
} from './queries';
import { fakeD1, type Responder } from './testing/fakeD1';

/**
 * The whole Worker as deployed, driven through its fetch handler on localhost
 * with the development bypass, against a recording fake of D1. These tests
 * pin the wiring and what each admin route sends to the database. Real SQL
 * runs in npm run smoke.
 */
const BASE = 'http://localhost:5173';

function client(respond: Responder = () => ({})) {
  const d1 = fakeD1(respond);
  const env: Env = { DB: d1.db, DEV_AUTH_BYPASS: 'true' };
  async function call(method: string, path: string, body?: unknown, base = BASE) {
    const headers: Record<string, string> = {};
    if (method !== 'GET') {
      headers.Origin = base;
      headers['Content-Type'] = 'application/json';
    }
    const response = await worker.fetch(
      new Request(`${base}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }),
      env,
    );
    const text = await response.text();
    return { status: response.status, headers: response.headers, json: text ? JSON.parse(text) : null };
  }
  return { call, d1 };
}

const privateRow = (id: number, createdAt: number, clicks7d = 0) => ({
  id,
  slug: `link-${id}`,
  url: `https://example.com/${id}`,
  title: `Link ${id}`,
  description: '',
  is_active: 1,
  expires_at: null,
  created_at: createdAt,
  updated_at: createdAt,
  tags: '[]',
  clicks7d,
});

const NOW = Date.now();
const TODAY = utcDayStart(NOW);

const publicRow = (id: number, url: string, overrides: object = {}) => ({
  id,
  slug: `p${id}xxxx`.slice(0, 6),
  url,
  title: new URL(url).hostname.replace(/^www\./, ''),
  is_active: 1,
  created_at: 1000 + id,
  updated_at: 1000 + id,
  click_total: 100,
  click_day: TODAY,
  click_today: 10,
  ...overrides,
});

describe('routing', () => {
  it('serves the owner API under /api/admin and nothing under the old paths', async () => {
    const { call } = client((sql) => (sql === PUBLIC_SUMMARY ? { results: [{ total: 0, today: null }] } : {}));
    expect((await call('GET', '/api/admin/me')).json).toEqual({ email: 'developer@localhost' });
    const old = await call('GET', '/api/links');
    expect(old.status).toBe(404);
    expect(old.json.error.code).toBe('not_found');
    expect((await call('GET', '/api/me')).status).toBe(404);
  });

  it('runs Access verification before a 404 under /api/admin', async () => {
    const { call } = client();
    const response = await call('GET', '/api/admin/nope', undefined, 'https://link.daffa.me');
    expect(response.status).toBe(500);
    expect(response.json.error.code).toBe('auth_not_configured');
  });

  it('does not put the public endpoint behind Access', async () => {
    const { call } = client();
    // Missing Turnstile settings, not missing Access settings, is what stops it.
    const response = await call('POST', '/api/public/links', {}, 'https://link.daffa.me');
    expect(response.json.error.code).toBe('public_not_configured');
  });

  it('marks every API answer as uncacheable and not for indexing', async () => {
    const { call } = client();
    for (const path of ['/api/admin/me', '/api/nope']) {
      const response = await call('GET', path);
      expect(response.headers.get('cache-control'), path).toBe('no-store');
      expect(response.headers.get('x-robots-tag'), path).toBe('noindex');
    }
  });
});

describe('GET /api/admin/links', () => {
  it('returns 25 private rows, a cursor after the 25th, and both counts', async () => {
    const rows = Array.from({ length: 26 }, (_, i) => privateRow(100 - i, 5000 - i));
    const { call, d1 } = client((sql) => {
      if (sql === LIST_SQL.private.newest) return { results: rows };
      if (sql === COUNT_PRIVATE) return { results: [{ total: 40, matching: 30 }] };
      if (sql === COUNT_PUBLIC) return { results: [{ total: 9, matching: 4 }] };
      return {};
    });
    const response = await call('GET', '/api/admin/links?q=Link&tag=career&status=active');
    const body = response.json as PrivateLinkList;
    expect(body.visibility).toBe('private');
    expect(body.links).toHaveLength(25);
    expect(body.counts).toEqual({ private: { total: 40, matching: 30 }, public: { total: 9, matching: 4 } });
    const cursor = decodeCursor(body.nextCursor ?? '', 'private', 'newest');
    expect(cursor).toMatchObject({ key: 5000 - 24, id: 100 - 24 });

    const params = d1.paramsOf(LIST_SQL.private.newest) ?? [];
    expect(params[0]).toBe(cursor.asOf);
    expect(params.slice(2)).toEqual(['%link%', 'career', 'active', null, null, 26]);
    // The tag narrows private links only.
    expect(d1.paramsOf(COUNT_PRIVATE)).toEqual([cursor.asOf, '%link%', 'career', 'active']);
    expect(d1.paramsOf(COUNT_PUBLIC)).toEqual([cursor.asOf, '%link%', 'active']);
  });

  it('continues from a cursor with its key, id and asOf, and ends with a null cursor', async () => {
    const asOf = 1_790_000_000_000;
    const raw = encodeCursor({ visibility: 'private', sort: 'clicks', key: 4, id: 12, asOf });
    const { call, d1 } = client((sql) => (sql === LIST_SQL.private.clicks ? { results: [privateRow(3, 10, 2)] } : {}));
    const body = (await call('GET', `/api/admin/links?sort=clicks&cursor=${raw}`)).json as PrivateLinkList;
    expect(body.nextCursor).toBeNull();
    const params = d1.paramsOf(LIST_SQL.private.clicks) ?? [];
    expect(params[0]).toBe(asOf);
    expect(params.slice(5)).toEqual([4, 12, 26]);
  });

  it('refuses a cursor of another sort with 400', async () => {
    const raw = encodeCursor({ visibility: 'private', sort: 'clicks', key: 4, id: 12, asOf: 1 });
    const { call, d1 } = client();
    const response = await call('GET', `/api/admin/links?sort=newest&cursor=${raw}`);
    expect(response.status).toBe(400);
    expect(d1.calls).toHaveLength(0);
  });

  it('marks public rows with today, the daily limit, and a blocked domain', async () => {
    const rows = [
      publicRow(11, 'https://docs.google.com/forms/x'),
      publicRow(12, 'https://www.youtube.com/watch?v=1', { click_today: 500 }),
      publicRow(13, 'https://grabgift-promo.com/klaim', { is_active: 0, click_day: TODAY - 86_400_000, click_today: 57 }),
    ];
    const { call, d1 } = client((sql, params) => {
      if (sql === LIST_SQL.public.clicks) return { results: rows };
      if (sql === BLOCKED_MATCH) {
        const suffixes = JSON.parse(String(params[0])) as string[];
        return { results: suffixes.includes('grabgift-promo.com') ? [{ host: 'grabgift-promo.com' }] : [] };
      }
      return {};
    });
    const body = (await call('GET', '/api/admin/links?visibility=public&sort=clicks&tag=career')).json as PublicLinkList;
    expect(body.visibility).toBe('public');
    expect(body.nextCursor).toBeNull();
    expect(body.links.map((l) => [l.host, l.status, l.clicksToday, l.limitReached, l.domainBlocked])).toEqual([
      ['docs.google.com', 'active', 10, false, false],
      ['youtube.com', 'active', 500, true, false],
      ['grabgift-promo.com', 'inactive', 0, false, true],
    ]);
    expect(Object.keys(body.links[0] ?? {})).not.toContain('tags');
    expect(d1.paramsOf(LIST_SQL.public.clicks)?.slice(1)).toEqual([null, 'all', null, null, 26]);
    expect(JSON.parse(String(d1.paramsOf(BLOCKED_MATCH)?.[0]))).toContain('www.youtube.com');
  });
});

describe('GET /api/admin/summary', () => {
  it('adds the public link count and today against the daily budget', async () => {
    const { call, d1 } = client((sql) => (sql === PUBLIC_SUMMARY ? { results: [{ total: 9, today: 1257 }] } : {}));
    const body = (await call('GET', '/api/admin/summary')).json as Summary;
    expect(body).toMatchObject({ publicTotal: 9, publicClicksToday: 1257, publicDailyBudget: 20000 });
    expect(d1.paramsOf(PUBLIC_SUMMARY)).toEqual([utcDayStart(body.windowEnd)]);
  });

  it('reads no budget row as zero', async () => {
    const { call } = client((sql) => (sql === PUBLIC_SUMMARY ? { results: [{ total: 0, today: null }] } : {}));
    expect(((await call('GET', '/api/admin/summary')).json as Summary).publicClicksToday).toBe(0);
  });
});

describe('public link moderation', () => {
  it('disables a public link and returns it', async () => {
    const { call, d1 } = client((sql) =>
      sql === PUBLIC_LINK_BY_ID ? { results: [publicRow(11, 'https://docs.google.com/x', { is_active: 0 })] } : {},
    );
    const response = await call('PATCH', '/api/admin/public-links/11', { isActive: false });
    expect(response.status).toBe(200);
    expect(response.json.link).toMatchObject({ id: 11, isActive: false, status: 'inactive' });
    expect(d1.paramsOf(SET_PUBLIC_ACTIVE)?.slice(0, 2)).toEqual([11, 0]);
  });

  it('answers 404 for a private or unknown id', async () => {
    const { call } = client();
    expect((await call('PATCH', '/api/admin/public-links/1', { isActive: true })).status).toBe(404);
    expect((await call('DELETE', '/api/admin/public-links/1')).status).toBe(404);
  });

  it('accepts nothing but isActive', async () => {
    const { call, d1 } = client();
    for (const body of [{}, { isActive: 'false' }, { isActive: true, url: 'https://x.com' }]) {
      expect((await call('PATCH', '/api/admin/public-links/11', body)).status).toBe(400);
    }
    expect(d1.calls).toHaveLength(0);
  });

  it('deletes with 204', async () => {
    const { call, d1 } = client((sql) => (sql === DELETE_PUBLIC_LINK ? { changes: 1 } : {}));
    expect((await call('DELETE', '/api/admin/public-links/11')).status).toBe(204);
    expect(d1.paramsOf(DELETE_PUBLIC_LINK)).toEqual([11]);
  });
});

describe('blocked domains', () => {
  const candidates = [
    { id: 1, url: 'https://example.com/a' },
    { id: 2, url: 'https://www.example.com/b' },
    { id: 3, url: 'https://shop.www.example.com/c' },
  ];

  it('adds a normalized host and disables exactly the links under it', async () => {
    const { call, d1 } = client((sql) => {
      if (sql === BLOCKED_INSERT) return { changes: 1 };
      if (sql === BLOCKED_BY_HOST) return { results: [{ host: 'www.example.com', created_at: 5 }] };
      if (sql === PUBLIC_HOST_CANDIDATES) return { results: candidates };
      if (sql === DISABLE_IDS) return { changes: 2 };
      return {};
    });
    const response = await call('POST', '/api/admin/blocked-domains', {
      host: 'HTTPS://WWW.Example.COM/path',
      disableActive: true,
    });
    expect(response.status).toBe(201);
    expect(response.json as BlockDomainResult).toEqual({
      domain: { host: 'www.example.com', createdAt: 5 },
      created: true,
      disabled: 2,
    });
    expect(d1.paramsOf(BLOCKED_INSERT)?.[0]).toBe('www.example.com');
    expect(d1.paramsOf(PUBLIC_HOST_CANDIDATES)).toEqual(['example.com', '%.www.example.com']);
    // Link 1 shares the title example.com but is not on www.example.com.
    expect(JSON.parse(String(d1.paramsOf(DISABLE_IDS)?.[1]))).toEqual([2, 3]);
  });

  it('answers 200 for a host already listed and leaves links alone without disableActive', async () => {
    const { call, d1 } = client((sql) =>
      sql === BLOCKED_BY_HOST ? { results: [{ host: 'example.com', created_at: 5 }] } : { changes: 0 },
    );
    const response = await call('POST', '/api/admin/blocked-domains', { host: 'example.com' });
    expect(response.status).toBe(200);
    expect(response.json).toMatchObject({ created: false, disabled: 0 });
    expect(d1.ran(PUBLIC_HOST_CANDIDATES)).toBe(false);
    expect(d1.ran(DISABLE_IDS)).toBe(false);
  });

  it('refuses an invalid host with 400 invalid_host', async () => {
    const { call, d1 } = client();
    for (const host of ['localhost', '10.0.0.1', '', 'not a host']) {
      const response = await call('POST', '/api/admin/blocked-domains', { host });
      expect(response.json.error.code, host).toBe('invalid_host');
    }
    expect((await call('POST', '/api/admin/blocked-domains', { host: 'a.com', disableActive: 'yes' })).status).toBe(400);
    expect(d1.calls).toHaveLength(0);
  });

  it('checks a host against the list and counts the links a block would disable', async () => {
    const { call } = client((sql, params) => {
      if (sql === BLOCKED_MATCH) {
        return { results: (JSON.parse(String(params[0])) as string[]).includes('example.com') ? [{ host: 'example.com' }] : [] };
      }
      if (sql === PUBLIC_HOST_CANDIDATES) return { results: candidates };
      return {};
    });
    const response = await call('GET', '/api/admin/blocked-domains/check?host=Shop.Example.com');
    expect(response.json).toEqual({ host: 'shop.example.com', blockedBy: 'example.com', activePublicLinks: 0 });
    const apex = await call('GET', '/api/admin/blocked-domains/check?host=example.com');
    expect(apex.json).toEqual({ host: 'example.com', blockedBy: 'example.com', activePublicLinks: 3 });
  });

  it('removes a host given in any form, and 404s an unknown one', async () => {
    const { call, d1 } = client((sql, params) => ({ changes: sql === BLOCKED_DELETE && params[0] === 'example.com' ? 1 : 0 }));
    expect((await call('DELETE', '/api/admin/blocked-domains/Example.COM.')).status).toBe(204);
    expect(d1.paramsOf(BLOCKED_DELETE)).toEqual(['example.com']);
    expect((await call('DELETE', '/api/admin/blocked-domains/other.com')).status).toBe(404);
  });
});

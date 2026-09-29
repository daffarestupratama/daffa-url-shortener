import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { PRODUCTION_ORIGIN, csrfMiddleware, isJsonContentType } from './csrf';
import type { AppEnv, Env } from './env';
import { handleError } from './errors';

function build() {
  const app = new Hono<AppEnv>();
  app.onError(handleError);
  app.use('*', csrfMiddleware);
  const ok = () => new Response('ok');
  app.get('/api/links', ok);
  app.post('/api/links', ok);
  app.patch('/api/links/1', ok);
  app.delete('/api/links/1', ok);
  return app;
}

const app = build();
const PROD = 'https://shorten.daffa.me';
const DEV = 'http://localhost:5173';
const env = (overrides: Partial<Env> = {}): Env => ({ DB: {} as D1Database, ...overrides });

interface Send {
  method: string;
  path?: string;
  base?: string;
  origin?: string | null;
  contentType?: string | null;
  bypass?: boolean;
}

async function send({
  method,
  path = method === 'POST' || method === 'GET' ? '/api/links' : '/api/links/1',
  base = PROD,
  origin = base,
  contentType = 'application/json',
  bypass = false,
}: Send) {
  const headers: Record<string, string> = {};
  if (origin !== null) headers.Origin = origin;
  if (contentType !== null) headers['Content-Type'] = contentType;
  const response = await app.request(
    `${base}${path}`,
    { method, headers, body: method === 'GET' ? undefined : '{}' },
    env(bypass ? { DEV_AUTH_BYPASS: 'true' } : {}),
  );
  const body = response.status === 200 ? null : ((await response.json()) as { error: { code: string } });
  return { status: response.status, code: body?.error.code };
}

describe('csrfMiddleware in production', () => {
  for (const method of ['POST', 'PATCH', 'DELETE']) {
    describe(method, () => {
      it('passes with the dashboard origin and a JSON content type', async () => {
        expect((await send({ method })).status).toBe(200);
      });

      it('passes with a charset parameter on the content type', async () => {
        const result = await send({ method, contentType: 'application/json; charset=utf-8' });
        expect(result.status).toBe(200);
      });

      it('refuses a foreign origin', async () => {
        expect(await send({ method, origin: 'https://evil.example' })).toEqual({
          status: 403,
          code: 'csrf_rejected',
        });
      });

      it('refuses a missing origin', async () => {
        expect(await send({ method, origin: null })).toEqual({ status: 403, code: 'csrf_rejected' });
      });

      it('refuses the literal null origin', async () => {
        expect(await send({ method, origin: 'null' })).toEqual({ status: 403, code: 'csrf_rejected' });
      });

      it('refuses a form friendly content type', async () => {
        for (const contentType of ['text/plain', 'application/x-www-form-urlencoded', null]) {
          expect(await send({ method, contentType }), String(contentType)).toEqual({
            status: 403,
            code: 'csrf_rejected',
          });
        }
      });

      it('refuses a lookalike origin', async () => {
        for (const origin of ['https://shorten.daffa.me.evil.example', 'http://shorten.daffa.me']) {
          expect((await send({ method, origin })).status, origin).toBe(403);
        }
      });
    });
  }

  it('leaves GET alone, whatever the origin', async () => {
    expect((await send({ method: 'GET', origin: 'https://evil.example', contentType: null })).status).toBe(200);
  });

  it('never trusts a localhost origin while the bypass is off', async () => {
    expect((await send({ method: 'POST', base: DEV })).status).toBe(403);
  });
});

describe('csrfMiddleware with the dev bypass', () => {
  it('passes a same origin request from the local dashboard', async () => {
    expect((await send({ method: 'POST', base: DEV, bypass: true })).status).toBe(200);
  });

  it('refuses another local port', async () => {
    const result = await send({ method: 'POST', base: DEV, origin: 'http://localhost:9999', bypass: true });
    expect(result).toEqual({ status: 403, code: 'csrf_rejected' });
  });

  it('refuses the production origin on a local request', async () => {
    const result = await send({ method: 'POST', base: DEV, origin: PRODUCTION_ORIGIN, bypass: true });
    expect(result.status).toBe(403);
  });

  it('still requires a JSON content type', async () => {
    const result = await send({ method: 'DELETE', base: DEV, contentType: 'text/plain', bypass: true });
    expect(result.status).toBe(403);
  });
});

describe('isJsonContentType', () => {
  it('compares the media type only, case insensitively', () => {
    expect(isJsonContentType('application/json')).toBe(true);
    expect(isJsonContentType('Application/JSON; charset=UTF-8')).toBe(true);
    expect(isJsonContentType('application/jsonp')).toBe(false);
    expect(isJsonContentType('text/json')).toBe(false);
    expect(isJsonContentType(undefined)).toBe(false);
  });
});

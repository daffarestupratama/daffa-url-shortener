import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { ApiError, ERRORS, handleError } from './errors';
import { foldReferrers, referrerHost } from './mappers';

/**
 * Em dash, en dash and semicolon. Built from code points so this file itself
 * contains no dash characters, which scripts/audit-copy.mjs would flag.
 */
const FORBIDDEN_PUNCTUATION = new RegExp(`[${String.fromCharCode(0x2014, 0x2013)};]`);

describe('error catalog', () => {
  it('follows the copy rules in every message', () => {
    for (const [code, { message }] of Object.entries(ERRORS)) {
      expect(message, code).not.toMatch(FORBIDDEN_PUNCTUATION);
      expect(message, code).toMatch(/^[A-Z].*\.$/);
      expect(message, code).not.toMatch(/\b(I|we|our|my|me|us)\b/i);
    }
  });

  it('maps each code to the status the API contract promises', () => {
    expect(ERRORS.invalid_id.status).toBe(400);
    expect(ERRORS.forbidden.status).toBe(403);
    expect(ERRORS.csrf_rejected.status).toBe(403);
    expect(ERRORS.not_found.status).toBe(404);
    expect(ERRORS.slug_taken.status).toBe(409);
    expect(ERRORS.payload_too_large.status).toBe(413);
    expect(ERRORS.auth_not_configured.status).toBe(500);
    expect(ERRORS.database_unavailable.status).toBe(503);
    expect(ERRORS.invalid_host.status).toBe(400);
    expect(ERRORS.blocked_domain.status).toBe(400);
    expect(ERRORS.turnstile_failed.status).toBe(403);
    expect(ERRORS.turnstile_unavailable.status).toBe(503);
    expect(ERRORS.rate_limited_ip.status).toBe(429);
    expect(ERRORS.rate_limited_global.status).toBe(429);
    expect(ERRORS.public_not_configured.status).toBe(500);
  });
});

describe('ApiError details', () => {
  it('adds extra fields to the error object and headers to the response', async () => {
    const app = new Hono();
    app.onError(handleError);
    app.get('/limited', () => {
      throw new ApiError('rate_limited_ip', undefined, { resetAt: 1_790_000_000_000 }, { 'Retry-After': '120' });
    });
    const response = await app.request('/limited');
    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('120');
    expect(await response.json()).toEqual({
      error: { code: 'rate_limited_ip', message: ERRORS.rate_limited_ip.message, resetAt: 1_790_000_000_000 },
    });
  });
});

describe('handleError', () => {
  const app = new Hono();
  app.onError(handleError);
  app.get('/api-error', () => {
    throw new ApiError('slug_taken', 'This slug is already used by "CV".');
  });
  app.get('/d1', () => {
    throw new Error('D1_ERROR: database is locked');
  });
  app.get('/bug', () => {
    throw new TypeError('Cannot read properties of undefined');
  });

  it('keeps the code and message of an ApiError', async () => {
    const response = await app.request('/api-error');
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: { code: 'slug_taken', message: 'This slug is already used by "CV".' },
    });
  });

  it('turns a D1 failure into 503 without leaking the detail', async () => {
    const response = await app.request('/d1');
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: { code: 'database_unavailable', message: ERRORS.database_unavailable.message },
    });
  });

  it('turns anything else into a generic 500', async () => {
    const response = await app.request('/bug');
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: { code: 'internal', message: ERRORS.internal.message } });
  });
});

describe('referrers', () => {
  it('reduces a referrer URL to its host without www', () => {
    expect(referrerHost('https://www.linkedin.com/feed/')).toBe('linkedin.com');
    expect(referrerHost('https://l.instagram.com/?u=x')).toBe('l.instagram.com');
    expect(referrerHost(null)).toBeNull();
    expect(referrerHost('')).toBeNull();
    expect(referrerHost('android-app://com.slack')).toBe('com.slack');
    expect(referrerHost('not a url')).toBe('not a url');
  });

  it('folds URLs from the same host together, largest first', () => {
    expect(
      foldReferrers(
        [
          { referrer: 'https://www.linkedin.com/feed/', count: 3 },
          { referrer: null, count: 5 },
          { referrer: 'https://linkedin.com/in/x', count: 4 },
          { referrer: 'https://t.co/abc', count: 1 },
        ],
        10,
      ),
    ).toEqual([
      { host: 'linkedin.com', count: 7 },
      { host: null, count: 5 },
      { host: 't.co', count: 1 },
    ]);
  });
});

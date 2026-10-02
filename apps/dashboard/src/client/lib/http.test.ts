import { describe, expect, it } from 'vitest';
import { linksQuery } from './api';
import { ApiError, toApiError } from './http';

const headers = (values: Record<string, string> = {}) => new Headers(values);

describe('toApiError', () => {
  it('reads code and message from the error body', () => {
    const error = toApiError(400, { error: { code: 'blocked_domain', message: 'The domain x.com is blocked.' } }, headers());
    expect(error).toBeInstanceOf(ApiError);
    expect(error.code).toBe('blocked_domain');
    expect(error.message).toBe('The domain x.com is blocked.');
    expect(error.status).toBe(400);
    expect(error.reason).toBeUndefined();
    expect(error.resetAt).toBeUndefined();
  });

  it('keeps the reason of a public invalid_url', () => {
    const error = toApiError(400, { error: { code: 'invalid_url', message: 'm', reason: 'shortener' } }, headers());
    expect(error.reason).toBe('shortener');
  });

  it('keeps resetAt and Retry-After of a rate limit', () => {
    const error = toApiError(
      429,
      { error: { code: 'rate_limited_ip', message: 'm', resetAt: 1_790_000_000_000 } },
      headers({ 'Retry-After': '1234' }),
    );
    expect(error.code).toBe('rate_limited_ip');
    expect(error.resetAt).toBe(1_790_000_000_000);
    expect(error.retryAfter).toBe(1234);
  });

  it('ignores fields of the wrong type and a malformed Retry-After', () => {
    const error = toApiError(
      429,
      { error: { code: 'rate_limited_global', message: 'm', resetAt: 'soon', reason: 7 } },
      headers({ 'Retry-After': 'Wed, 21 Oct 2026 07:28:00 GMT' }),
    );
    expect(error.resetAt).toBeUndefined();
    expect(error.reason).toBeUndefined();
    expect(error.retryAfter).toBeUndefined();
  });

  it('falls back to a generic error for a body without the error shape', () => {
    const error = toApiError(502, { ok: false }, headers());
    expect(error.code).toBe('internal');
    expect(error.message).toBe('The request failed.');
    expect(error.status).toBe(502);
  });
});

describe('linksQuery', () => {
  const base = { visibility: 'private', q: '', tag: '', status: 'all', sort: 'newest', cursor: null } as const;

  it('leaves every default out', () => {
    expect(linksQuery(base)).toBe('');
  });

  it('writes the public tab, filters, and the cursor', () => {
    expect(linksQuery({ ...base, visibility: 'public', q: 'docs', status: 'active', sort: 'clicks', cursor: 'abc_-1' })).toBe(
      '?visibility=public&q=docs&status=active&sort=clicks&cursor=abc_-1',
    );
  });

  it('sends the tag as given, the API ignores it on the public tab', () => {
    expect(linksQuery({ ...base, tag: 'career' })).toBe('?tag=career');
  });
});

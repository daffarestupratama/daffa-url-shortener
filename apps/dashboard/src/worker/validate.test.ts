import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import type { AppEnv } from './env';
import { ApiError, handleError } from './errors';
import {
  MAX_BODY_BYTES,
  jsonBodyLimit,
  likePattern,
  parseId,
  parseLinkInput,
  parseListQuery,
  parseOptionalId,
  parsePage,
  parseRange,
} from './validate';

/** Runs `fn` and returns the ApiError it throws, so the code and message can be checked. */
function apiError(fn: () => unknown): ApiError {
  try {
    fn();
  } catch (error) {
    if (error instanceof ApiError) return error;
    throw error;
  }
  throw new Error('Expected an ApiError to be thrown.');
}

describe('parseId', () => {
  it('accepts plain positive whole numbers', () => {
    expect(parseId('1')).toBe(1);
    expect(parseId('42')).toBe(42);
    expect(parseId(String(Number.MAX_SAFE_INTEGER))).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('rejects everything else with invalid_id', () => {
    for (const raw of ['', '0', '-1', '1.5', '1e3', 'abc', '01', ' 1', '0x10', '9007199254740993', undefined]) {
      expect(apiError(() => parseId(raw)).code, String(raw)).toBe('invalid_id');
    }
  });

  it('treats an absent optional id as null', () => {
    expect(parseOptionalId(undefined)).toBeNull();
    expect(parseOptionalId('')).toBeNull();
    expect(parseOptionalId('7')).toBe(7);
    expect(apiError(() => parseOptionalId('x')).code).toBe('invalid_id');
  });
});

describe('parseRange', () => {
  it('accepts the five ranges and defaults to 30d', () => {
    for (const range of ['24h', '7d', '30d', '90d', 'all']) expect(parseRange(range)).toBe(range);
    expect(parseRange(undefined)).toBe('30d');
    expect(parseRange('')).toBe('30d');
  });

  it('rejects anything else, including the prototype keys', () => {
    for (const raw of ['24j', '7h', 'semua', '1y', '7D']) {
      expect(apiError(() => parseRange(raw)).code, raw).toBe('bad_request');
    }
  });
});

describe('parsePage', () => {
  it('accepts zero and positive whole numbers, defaulting to zero', () => {
    expect(parsePage(undefined)).toBe(0);
    expect(parsePage('0')).toBe(0);
    expect(parsePage('12')).toBe(12);
  });

  it('rejects negatives, decimals and text', () => {
    for (const raw of ['-1', '1.5', 'abc', '01', ' 2']) {
      expect(apiError(() => parsePage(raw)).code, raw).toBe('bad_request');
    }
  });
});

describe('parseListQuery', () => {
  it('defaults to everything, newest first', () => {
    expect(parseListQuery({})).toEqual({ q: null, tag: null, status: 'all', sort: 'newest' });
  });

  it('lowercases the search and normalizes the tag', () => {
    expect(parseListQuery({ q: '  KaGGle ', tag: '#Career' })).toMatchObject({ q: 'kaggle', tag: 'career' });
  });

  it('accepts every sort order', () => {
    for (const sort of ['newest', 'oldest', 'clicks', 'least'] as const) {
      expect(parseListQuery({ sort }).sort).toBe(sort);
    }
  });

  it('rejects an unknown status or sort', () => {
    expect(apiError(() => parseListQuery({ status: 'aktif' })).code).toBe('bad_request');
    for (const sort of ['popular', 'Oldest', 'least-clicks']) {
      expect(apiError(() => parseListQuery({ sort })).code, sort).toBe('bad_request');
    }
  });

  it('rejects an overlong search', () => {
    expect(apiError(() => parseListQuery({ q: 'a'.repeat(201) })).code).toBe('bad_request');
  });
});

describe('likePattern', () => {
  it('wraps the text and escapes LIKE wildcards', () => {
    expect(likePattern('cv')).toBe('%cv%');
    expect(likePattern('50%_off\\')).toBe('%50\\%\\_off\\\\%');
  });
});

describe('parseLinkInput', () => {
  const valid = { url: 'https://example.com/a', slug: 'example' };

  it('accepts a minimal create and a full one', () => {
    expect(parseLinkInput(valid, 'create')).toEqual(valid);
    expect(
      parseLinkInput(
        {
          ...valid,
          title: '  Example  ',
          description: 'Notes',
          tags: ['#Career', 'data science', 'career'],
          expiresAt: 1_790_000_000_000,
          isActive: false,
        },
        'create',
      ),
    ).toEqual({
      ...valid,
      title: 'Example',
      description: 'Notes',
      tags: ['career', 'data-science'],
      expiresAt: 1_790_000_000_000,
      isActive: false,
    });
  });

  it('requires url and slug on create, with the form wording', () => {
    const noUrl = apiError(() => parseLinkInput({ slug: 'x1' }, 'create'));
    expect(noUrl.code).toBe('invalid_url');
    expect(noUrl.message).toBe('Destination URL is required.');
    const noSlug = apiError(() => parseLinkInput({ url: valid.url }, 'create'));
    expect(noSlug.code).toBe('invalid_slug');
    expect(noSlug.message).toBe('Slug is required. Press Generate to fill in a random slug.');
  });

  it('reuses the shared slug and URL messages', () => {
    expect(apiError(() => parseLinkInput({ ...valid, slug: 'admin' }, 'create')).message).toBe(
      '"admin" is a reserved word and cannot be used.',
    );
    expect(apiError(() => parseLinkInput({ ...valid, url: 'https://daffa.me/x' }, 'create')).message).toBe(
      'Destination URL cannot point to daffa.me because it would create a redirect loop.',
    );
  });

  it('accepts a partial patch but not an empty one', () => {
    expect(parseLinkInput({ title: 'New' }, 'patch')).toEqual({ title: 'New' });
    expect(apiError(() => parseLinkInput({}, 'patch')).code).toBe('invalid_field');
  });

  it('allows an expiry in the past and clearing it with null', () => {
    expect(parseLinkInput({ expiresAt: 1 }, 'patch')).toEqual({ expiresAt: 1 });
    expect(parseLinkInput({ expiresAt: null }, 'patch')).toEqual({ expiresAt: null });
  });

  it('rejects unknown fields, wrong types and oversized values', () => {
    const cases: Array<[unknown, string]> = [
      [{ ...valid, color: 'red' }, 'invalid_field'],
      [[], 'invalid_field'],
      [null, 'invalid_field'],
      [{ ...valid, url: 42 }, 'invalid_field'],
      [{ ...valid, title: 'x'.repeat(201) }, 'invalid_field'],
      [{ ...valid, description: 'x'.repeat(2001) }, 'invalid_field'],
      [{ ...valid, tags: 'career' }, 'invalid_field'],
      [{ ...valid, tags: [1] }, 'invalid_field'],
      [{ ...valid, tags: Array.from({ length: 21 }, (_, i) => `t${i}`) }, 'invalid_field'],
      [{ ...valid, tags: ['x'.repeat(41)] }, 'invalid_field'],
      [{ ...valid, expiresAt: '2026-10-01' }, 'invalid_field'],
      [{ ...valid, expiresAt: 1.5 }, 'invalid_field'],
      [{ ...valid, expiresAt: -1 }, 'invalid_field'],
      [{ ...valid, isActive: 'yes' }, 'invalid_field'],
      [{ ...valid, url: `https://example.com/${'a'.repeat(2048)}` }, 'invalid_url'],
    ];
    for (const [body, code] of cases) {
      expect(apiError(() => parseLinkInput(body, 'create')).code, JSON.stringify(body).slice(0, 60)).toBe(code);
    }
  });
});

describe('jsonBodyLimit', () => {
  const app = new Hono<AppEnv>();
  app.onError(handleError);
  app.use('*', jsonBodyLimit);
  app.post('/api/links', async (c) => c.json({ size: (await c.req.text()).length }));

  const post = (bytes: number) =>
    app.request('https://shorten.daffa.me/api/links', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'x'.repeat(bytes),
    });

  it('lets exactly 16 KB through', async () => {
    const response = await post(MAX_BODY_BYTES);
    expect(response.status).toBe(200);
  });

  it('refuses one byte more with a JSON 413', async () => {
    const response = await post(MAX_BODY_BYTES + 1);
    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({ error: { code: 'payload_too_large' } });
  });
});

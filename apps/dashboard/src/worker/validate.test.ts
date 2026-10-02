import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import type { AppEnv } from './env';
import { ApiError, handleError } from './errors';
import { encodeCursor } from './cursor';
import {
  MAX_BODY_BYTES,
  jsonBodyLimit,
  likePattern,
  parseHostInput,
  parseId,
  parseLinkInput,
  parseListQuery,
  parseOptionalId,
  parsePage,
  parsePublicCreateBody,
  parseRange,
  parseSearch,
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
    expect(parseListQuery({})).toEqual({
      visibility: 'private',
      q: null,
      tag: null,
      status: 'all',
      sort: 'newest',
      cursor: null,
    });
  });

  it('accepts both tabs and refuses anything else', () => {
    expect(parseListQuery({ visibility: 'public' }).visibility).toBe('public');
    expect(apiError(() => parseListQuery({ visibility: 'all' })).code).toBe('bad_request');
  });

  it('decodes a cursor of the same tab and sort, and refuses a foreign one', () => {
    const cursor = { visibility: 'public', sort: 'clicks', key: 300, id: 14, asOf: 1 } as const;
    const raw = encodeCursor(cursor);
    expect(parseListQuery({ visibility: 'public', sort: 'clicks', cursor: raw }).cursor).toEqual(cursor);
    expect(apiError(() => parseListQuery({ visibility: 'public', sort: 'newest', cursor: raw })).code).toBe(
      'bad_request',
    );
    expect(apiError(() => parseListQuery({ cursor: 'garbage!' })).code).toBe('bad_request');
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

  it('stores the URL normalized, on create and on patch', () => {
    expect(parseLinkInput({ ...valid, url: '  example.com/a ' }, 'create').url).toBe('https://example.com/a');
    expect(parseLinkInput({ url: 'HTTP://Example.com/A' }, 'patch').url).toBe('http://Example.com/A');
    expect(apiError(() => parseLinkInput({ url: 'javascript:alert(1)' }, 'patch')).code).toBe('invalid_url');
  });

  it('counts the length after the https:// prefix is added', () => {
    const bare = `example.com/${'a'.repeat(2040 - 'example.com/'.length)}`;
    expect(parseLinkInput({ url: bare }, 'patch').url).toHaveLength(2048);
    const error = apiError(() => parseLinkInput({ url: `${bare}x` }, 'patch'));
    expect(error.code).toBe('invalid_url');
    expect(error.message).toBe('Destination URL must be 2048 characters or fewer.');
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
  app.post('/api/admin/links', async (c) => c.json({ size: (await c.req.text()).length }));

  const post = (bytes: number) =>
    app.request('https://link.daffa.me/api/admin/links', {
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

describe('parsePublicCreateBody', () => {
  const token = 'XXXX.DUMMY.TOKEN.XXXX';

  it('accepts url, slug and token, and leaves the slug out when absent', () => {
    expect(parsePublicCreateBody({ url: 'example.com', slug: 'x7kq2m', turnstileToken: token })).toEqual({
      url: 'example.com',
      slug: 'x7kq2m',
      turnstileToken: token,
    });
    expect(parsePublicCreateBody({ url: 'example.com', turnstileToken: token })).toEqual({
      url: 'example.com',
      turnstileToken: token,
    });
  });

  it('treats a missing URL as empty, so checkPublicUrl reports it as required', () => {
    expect(parsePublicCreateBody({ turnstileToken: token }).url).toBe('');
  });

  it('refuses owner fields such as tags or a title', () => {
    for (const key of ['tags', 'title', 'expiresAt', 'isActive']) {
      expect(apiError(() => parsePublicCreateBody({ url: 'a.com', turnstileToken: token, [key]: 'x' })).code).toBe(
        'invalid_field',
      );
    }
  });

  it('only takes slugs a visitor could have drawn', () => {
    for (const slug of ['cv', 'X7KQ2M', 'x7kq2m0', 'x7-q2m', 'assets', 'x7kq2o']) {
      expect(apiError(() => parsePublicCreateBody({ url: 'a.com', slug, turnstileToken: token })).code, slug).toBe(
        'invalid_slug',
      );
    }
  });

  it('refuses a missing, empty or oversized token as a failed verification', () => {
    for (const turnstileToken of [undefined, '', 'x'.repeat(2049)]) {
      expect(apiError(() => parsePublicCreateBody({ url: 'a.com', turnstileToken })).code).toBe('turnstile_failed');
    }
    expect(parsePublicCreateBody({ url: 'a.com', turnstileToken: 'x'.repeat(2048) }).turnstileToken).toHaveLength(2048);
  });
});

describe('parseHostInput and parseSearch', () => {
  it('normalizes a pasted URL, case and a trailing dot to one hostname', () => {
    expect(parseHostInput('HTTPS://Sub.Example.ORG/path?x=1')).toBe('sub.example.org');
    expect(parseHostInput(' example.com. ')).toBe('example.com');
    expect(parseHostInput('bücher.de')).toBe('xn--bcher-kva.de');
  });

  it('refuses anything that is not a dotted hostname', () => {
    for (const raw of ['', 'localhost', '127.0.0.1', '[::1]', 'not a host', 42, null, 'a.'.repeat(1100)]) {
      expect(apiError(() => parseHostInput(raw)).code, String(raw).slice(0, 20)).toBe('invalid_host');
    }
  });

  it('lowercases the search and caps it at 200 characters', () => {
    expect(parseSearch('  PROMO ')).toBe('promo');
    expect(parseSearch(undefined)).toBeNull();
    expect(apiError(() => parseSearch('a'.repeat(201))).code).toBe('bad_request');
  });
});

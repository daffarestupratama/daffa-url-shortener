import {
  isPublicSlug,
  normalizeHost,
  normalizeTag,
  normalizeTags,
  normalizeUrlInput,
  validateSlug,
  validateUrl,
  type LinkInput,
  type LinkSort,
  type LinkStatusFilter,
  type PublicCreateInput,
  type Range,
  type Visibility,
} from '@daffa/shared';
import type { Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { decodeCursor, type Cursor } from './cursor';
import { ApiError, errorResponse } from './errors';
import { MAX_TOKEN_LENGTH } from './turnstile';

export const MAX_BODY_BYTES = 16 * 1024;
/** A public request holds a URL, a slug and a token, each 2048 characters at most. */
export const PUBLIC_MAX_BODY_BYTES = 8 * 1024;
export const PAGE_SIZE = 10;

const MAX_QUERY_LENGTH = 200;
const MAX_URL_LENGTH = 2048;
const MAX_TITLE_LENGTH = 200;
const MAX_DESCRIPTION_LENGTH = 2000;
const MAX_TAGS = 20;
const MAX_TAG_LENGTH = 40;

/** Rejects any request body over 16 KB with a JSON 413. */
export const jsonBodyLimit = bodyLimit({
  maxSize: MAX_BODY_BYTES,
  onError: (c) => errorResponse(c, 'payload_too_large'),
});

/** The tighter limit for the anonymous endpoint. */
export const publicBodyLimit = bodyLimit({
  maxSize: PUBLIC_MAX_BODY_BYTES,
  onError: (c) => errorResponse(c, 'payload_too_large', 'The request body is larger than 8 KB.'),
});

const POSITIVE_INTEGER = /^[1-9][0-9]*$/;
const NON_NEGATIVE_INTEGER = /^(0|[1-9][0-9]*)$/;

/** Path ids are positive whole numbers written plainly: no sign, no leading zero, no decimals. */
export function parseId(raw: string | undefined): number {
  if (!raw || !POSITIVE_INTEGER.test(raw)) throw new ApiError('invalid_id');
  const id = Number(raw);
  if (!Number.isSafeInteger(id)) throw new ApiError('invalid_id');
  return id;
}

/** An optional id in the query string, as used by ?exclude= on slug availability. */
export function parseOptionalId(raw: string | undefined): number | null {
  if (raw === undefined || raw === '') return null;
  return parseId(raw);
}

const RANGES: readonly Range[] = ['24h', '7d', '30d', '90d', 'all'];

export function parseRange(raw: string | undefined, fallback: Range = '30d'): Range {
  if (raw === undefined || raw === '') return fallback;
  if (!(RANGES as readonly string[]).includes(raw)) {
    throw new ApiError('bad_request', 'The range must be one of 24h, 7d, 30d, 90d, or all.');
  }
  return raw as Range;
}

export function parsePage(raw: string | undefined): number {
  if (raw === undefined || raw === '') return 0;
  const page = Number(raw);
  if (!NON_NEGATIVE_INTEGER.test(raw) || !Number.isSafeInteger(page)) {
    throw new ApiError('bad_request', 'The page must be zero or a positive whole number.');
  }
  return page;
}

export interface ListQuery {
  visibility: Visibility;
  /** Lowercased search text, or null when absent. */
  q: string | null;
  /** Narrows private links only. Public links have no tags. */
  tag: string | null;
  status: LinkStatusFilter;
  sort: LinkSort;
  /** Null on the first page. */
  cursor: Cursor | null;
}

const VISIBILITIES: readonly Visibility[] = ['private', 'public'];
const STATUSES: readonly LinkStatusFilter[] = ['all', 'active', 'inactive', 'expired'];
const SORTS: readonly LinkSort[] = ['newest', 'oldest', 'clicks', 'least'];

export function parseListQuery(query: Record<string, string | undefined>): ListQuery {
  const visibility = (query.visibility || 'private') as Visibility;
  if (!VISIBILITIES.includes(visibility)) {
    throw new ApiError('bad_request', 'The visibility must be private or public.');
  }

  const q = (query.q ?? '').trim().toLowerCase();
  if (q.length > MAX_QUERY_LENGTH) {
    throw new ApiError('bad_request', 'The search text must be 200 characters or fewer.');
  }

  const tag = normalizeTag(query.tag ?? '');
  if (tag.length > MAX_TAG_LENGTH) {
    throw new ApiError('bad_request', 'The tag filter must be 40 characters or fewer.');
  }

  const status = (query.status ?? 'all') as LinkStatusFilter;
  if (!STATUSES.includes(status)) {
    throw new ApiError(
      'bad_request',
      'The status filter must be all, active, inactive, or expired.',
    );
  }

  const sort = (query.sort ?? 'newest') as LinkSort;
  if (!SORTS.includes(sort)) {
    throw new ApiError('bad_request', 'The sort order must be newest, oldest, clicks, or least.');
  }

  const cursor = query.cursor ? decodeCursor(query.cursor, visibility, sort) : null;

  return { visibility, q: q || null, tag: tag || null, status, sort, cursor };
}

/** The search box of the blocked domains list. */
export function parseSearch(raw: string | undefined): string | null {
  const q = (raw ?? '').trim().toLowerCase();
  if (q.length > MAX_QUERY_LENGTH) {
    throw new ApiError('bad_request', 'The search text must be 200 characters or fewer.');
  }
  return q || null;
}

/** Escapes LIKE wildcards so the search text matches literally. Used with ESCAPE '\'. */
export function likePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

const LINK_FIELDS: readonly string[] = [
  'url',
  'slug',
  'title',
  'description',
  'tags',
  'expiresAt',
  'isActive',
];

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new ApiError('invalid_field', `The field "${field}" must be text.`);
  }
  return value;
}

/**
 * Validates the body of a create or an edit. Unknown fields are rejected so a
 * client typo fails loudly instead of being silently ignored. Slug and URL
 * errors reuse the shared validators, so the wording matches the form exactly.
 */
export function parseLinkInput(body: unknown, mode: 'create' | 'patch'): LinkInput {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new ApiError('invalid_field', 'The request body must be a JSON object.');
  }
  const record = body as Record<string, unknown>;

  for (const key of Object.keys(record)) {
    if (!LINK_FIELDS.includes(key)) {
      throw new ApiError('invalid_field', `The field "${key}" is not recognized.`);
    }
  }

  const input: LinkInput = {};

  if ('url' in record) {
    // Stored as normalized, so example.com is saved as https://example.com.
    // The length counts after normalization, prefix included.
    const url = normalizeUrlInput(requireString(record.url, 'url'));
    if (url.length > MAX_URL_LENGTH) {
      throw new ApiError('invalid_url', 'Destination URL must be 2048 characters or fewer.');
    }
    const problem = validateUrl(url, { required: true });
    if (problem) throw new ApiError('invalid_url', problem);
    input.url = url;
  }

  if ('slug' in record) {
    const slug = requireString(record.slug, 'slug');
    const problem = validateSlug(slug, { required: true });
    if (problem) throw new ApiError('invalid_slug', problem);
    input.slug = slug;
  }

  if ('title' in record) {
    const title = requireString(record.title, 'title').trim();
    if (title.length > MAX_TITLE_LENGTH) {
      throw new ApiError('invalid_field', 'The title must be 200 characters or fewer.');
    }
    input.title = title;
  }

  if ('description' in record) {
    const description = requireString(record.description, 'description').trim();
    if (description.length > MAX_DESCRIPTION_LENGTH) {
      throw new ApiError('invalid_field', 'The description must be 2000 characters or fewer.');
    }
    input.description = description;
  }

  if ('tags' in record) {
    const raw = record.tags;
    if (!Array.isArray(raw) || raw.some((tag) => typeof tag !== 'string')) {
      throw new ApiError('invalid_field', 'The field "tags" must be a list of text values.');
    }
    const tags = normalizeTags(raw as string[]);
    if (tags.length > MAX_TAGS) {
      throw new ApiError('invalid_field', 'A link can have at most 20 tags.');
    }
    if (tags.some((tag) => tag.length > MAX_TAG_LENGTH)) {
      throw new ApiError('invalid_field', 'Each tag must be 40 characters or fewer.');
    }
    input.tags = tags;
  }

  if ('expiresAt' in record) {
    const value = record.expiresAt;
    if (value !== null && !(typeof value === 'number' && Number.isSafeInteger(value) && value > 0)) {
      throw new ApiError(
        'invalid_field',
        'The expiry must be a timestamp in milliseconds or null.',
      );
    }
    // A past date is allowed. The design shows "Date has passed" and the link becomes expired.
    input.expiresAt = value;
  }

  if ('isActive' in record) {
    if (typeof record.isActive !== 'boolean') {
      throw new ApiError('invalid_field', 'The field "isActive" must be true or false.');
    }
    input.isActive = record.isActive;
  }

  if (mode === 'create') {
    if (input.url === undefined) throw new ApiError('invalid_url', 'Destination URL is required.');
    if (input.slug === undefined) {
      throw new ApiError('invalid_slug', 'Slug is required. Press Generate to fill in a random slug.');
    }
  } else if (Object.keys(input).length === 0) {
    throw new ApiError('invalid_field', 'The request contains no fields to update.');
  }

  return input;
}

const PUBLIC_FIELDS: readonly string[] = ['url', 'slug', 'turnstileToken'];

/**
 * The shape of a public create body, checked before anything costs a lookup
 * or a call to Turnstile. The URL itself is checked afterwards with
 * checkPublicUrl. A missing or oversized token is refused here as a failed
 * verification, without asking siteverify.
 */
export function parsePublicCreateBody(body: unknown): PublicCreateInput {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new ApiError('invalid_field', 'The request body must be a JSON object.');
  }
  const record = body as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!PUBLIC_FIELDS.includes(key)) {
      throw new ApiError('invalid_field', `The field "${key}" is not recognized.`);
    }
  }

  const url = 'url' in record ? requireString(record.url, 'url') : '';

  let slug: string | undefined;
  if (record.slug !== undefined) {
    slug = requireString(record.slug, 'slug');
    if (!isPublicSlug(slug)) {
      throw new ApiError(
        'invalid_slug',
        'Public slugs are 6 characters generated by the page. Press Generate for a new one.',
      );
    }
  }

  const token = record.turnstileToken;
  if (record.turnstileToken !== undefined && typeof token !== 'string') {
    throw new ApiError('invalid_field', 'The field "turnstileToken" must be text.');
  }
  if (typeof token !== 'string' || token.length === 0 || token.length > MAX_TOKEN_LENGTH) {
    throw new ApiError('turnstile_failed');
  }

  return slug === undefined ? { url, turnstileToken: token } : { url, slug, turnstileToken: token };
}

/** A hostname typed or pasted by the owner, such as a URL or Example.COM. */
export function parseHostInput(raw: unknown): string {
  if (typeof raw !== 'string' || raw.length > 2048) throw new ApiError('invalid_host');
  const host = normalizeHost(raw);
  if (!host) throw new ApiError('invalid_host');
  return host;
}

/** Reads the body as JSON. An empty body counts as an empty object. */
export async function readJson(c: Context): Promise<unknown> {
  const text = await c.req.text();
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new ApiError('invalid_json');
  }
}

import type { LinkSort, Visibility } from '@daffa/shared';
import { ApiError } from './errors';

/**
 * The position after the last row of a links page. The client treats it as an
 * opaque string and passes it back as ?cursor= for the next page.
 *
 * It carries its own visibility and sort, so a cursor can never be replayed
 * against another tab or order, and the asOf moment of the first page, which
 * keeps every later page on the same snapshot (see the list notes in
 * queries.ts).
 */
export interface Cursor {
  visibility: Visibility;
  sort: LinkSort;
  /** Sort key of the last row: created_at, clicks7d, or click_total. */
  key: number;
  /** id of the last row, the tie breaker. */
  id: number;
  /** The moment the first page was read. */
  asOf: number;
}

const VISIBILITIES: readonly Visibility[] = ['private', 'public'];
const SORTS: readonly LinkSort[] = ['newest', 'oldest', 'clicks', 'least'];
const MAX_CURSOR_LENGTH = 200;

function toBase64Url(text: string): string {
  return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(value: string): string {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  return atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
}

export function encodeCursor(cursor: Cursor): string {
  const { visibility, sort, key, id, asOf } = cursor;
  return toBase64Url(JSON.stringify({ v: visibility, s: sort, k: key, i: id, t: asOf }));
}

const isWhole = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

const INVALID = 'The cursor is not valid. Load the list again from the first page.';

/**
 * Reads a cursor back and checks that it belongs to the requested tab and
 * sort. Anything malformed, edited, or foreign is a 400, never a guess.
 */
export function decodeCursor(raw: string, visibility: Visibility, sort: LinkSort): Cursor {
  if (raw.length > MAX_CURSOR_LENGTH || !/^[A-Za-z0-9_-]+$/.test(raw)) {
    throw new ApiError('bad_request', INVALID);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(fromBase64Url(raw));
  } catch {
    throw new ApiError('bad_request', INVALID);
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new ApiError('bad_request', INVALID);
  }
  const { v, s, k, i, t } = parsed as Record<string, unknown>;
  if (
    !VISIBILITIES.includes(v as Visibility) ||
    !SORTS.includes(s as LinkSort) ||
    !isWhole(k) ||
    !isWhole(i) ||
    i === 0 ||
    !isWhole(t)
  ) {
    throw new ApiError('bad_request', INVALID);
  }
  if (v !== visibility || s !== sort) {
    throw new ApiError(
      'bad_request',
      'The cursor belongs to another tab or sort order. Load the list again from the first page.',
    );
  }
  return { visibility: v as Visibility, sort: s as LinkSort, key: k, id: i, asOf: t };
}

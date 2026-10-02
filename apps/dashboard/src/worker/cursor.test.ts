import { describe, expect, it } from 'vitest';
import { decodeCursor, encodeCursor, type Cursor } from './cursor';
import { ApiError } from './errors';

const cursor: Cursor = { visibility: 'private', sort: 'clicks', key: 12, id: 7, asOf: 1_790_000_000_000 };

function refusal(raw: string, visibility: Cursor['visibility'] = 'private', sort: Cursor['sort'] = 'clicks') {
  try {
    decodeCursor(raw, visibility, sort);
  } catch (error) {
    if (error instanceof ApiError) return error;
    throw error;
  }
  throw new Error('Expected the cursor to be refused.');
}

describe('cursor', () => {
  it('round trips through an opaque URL safe string', () => {
    const raw = encodeCursor(cursor);
    expect(raw).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeCursor(raw, 'private', 'clicks')).toEqual(cursor);
  });

  it('keeps a key of zero, which a least clicks page often ends on', () => {
    const zero = { ...cursor, key: 0 };
    expect(decodeCursor(encodeCursor(zero), 'private', 'clicks')).toEqual(zero);
  });

  it('refuses a cursor from another tab or sort order', () => {
    const raw = encodeCursor(cursor);
    expect(refusal(raw, 'public', 'clicks').code).toBe('bad_request');
    expect(refusal(raw, 'private', 'newest').message).toMatch(/another tab or sort order/);
  });

  it('refuses anything edited or malformed', () => {
    const edit = (patch: object) =>
      btoa(JSON.stringify({ v: 'private', s: 'clicks', k: 12, i: 7, t: 1, ...patch }))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
    for (const raw of [
      'not base64!',
      '',
      'e30',
      btoa('[]'),
      edit({ k: -1 }),
      edit({ k: 1.5 }),
      edit({ k: '12' }),
      edit({ i: 0 }),
      edit({ t: null }),
      edit({ v: 'secret' }),
      'a'.repeat(201),
    ]) {
      expect(refusal(raw).code, raw).toBe('bad_request');
    }
  });
});

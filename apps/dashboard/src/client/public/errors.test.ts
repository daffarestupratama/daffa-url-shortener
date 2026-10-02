import { describe, expect, it } from 'vitest';
import { ApiError, type ClientErrorCode } from '../lib/http';
import { publicErrorState } from './errors';

const NOW = Date.UTC(2026, 9, 3, 7, 32, 12);
const NEXT_HOUR = Date.UTC(2026, 9, 3, 8);

describe('publicErrorState', () => {
  it('shows invalid URLs under the field with the server message, for every reason', () => {
    for (const reason of ['required', 'too_long', 'invalid', 'ip', 'loop', 'shortener']) {
      const error = new ApiError('invalid_url', `message for ${reason}`, 400, { reason });
      expect(publicErrorState(error, NOW)).toEqual({ kind: 'field', message: `message for ${reason}` });
    }
  });

  it('shows a blocked domain under the field', () => {
    const error = new ApiError('blocked_domain', 'The domain x.site is blocked for public links and cannot be shortened.', 400);
    expect(publicErrorState(error, NOW)).toEqual({ kind: 'field', message: error.message });
  });

  it('marks the Turnstile slot when verification failed', () => {
    expect(publicErrorState(new ApiError('turnstile_failed', 'm', 403), NOW)).toEqual({ kind: 'turnstile' });
  });

  it('opens the visitor and the global rate dialog with resetAt', () => {
    expect(publicErrorState(new ApiError('rate_limited_ip', 'm', 429, { resetAt: NEXT_HOUR }), NOW)).toEqual({
      kind: 'rate',
      scope: 'visitor',
      resetAt: NEXT_HOUR,
    });
    expect(publicErrorState(new ApiError('rate_limited_global', 'm', 429, { resetAt: NEXT_HOUR }), NOW)).toEqual({
      kind: 'rate',
      scope: 'global',
      resetAt: NEXT_HOUR,
    });
  });

  it('counts down to the next clock hour when resetAt is missing', () => {
    expect(publicErrorState(new ApiError('rate_limited_ip', 'm', 429), NOW)).toEqual({
      kind: 'rate',
      scope: 'visitor',
      resetAt: NEXT_HOUR,
    });
  });

  it('shows the retry panel for everything else', () => {
    const others: ClientErrorCode[] = [
      'turnstile_unavailable',
      'network',
      'timeout',
      'bad_response',
      'internal',
      'database_unavailable',
      'public_not_configured',
      'csrf_rejected',
      'payload_too_large',
      'invalid_slug',
      'invalid_field',
      'bad_request',
    ];
    for (const code of others) {
      expect(publicErrorState(new ApiError(code, 'm', 500), NOW), code).toEqual({ kind: 'retry' });
    }
    expect(publicErrorState(new TypeError('Failed to fetch'), NOW)).toEqual({ kind: 'retry' });
  });
});

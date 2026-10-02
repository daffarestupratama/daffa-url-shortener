import { nextHourStart } from '@daffa/shared';
import { ApiError } from '../lib/http';

/** What the public form shows for a failed create, one of the designed states. */
export type PublicErrorState =
  /** Under the URL field, with the server's message: invalid_url of any reason, or blocked_domain. */
  | { kind: 'field'; message: string }
  /** The Turnstile slot turns red and asks for the check again. */
  | { kind: 'turnstile' }
  /** One of the two rate limit dialogs, counting down to resetAt. */
  | { kind: 'rate'; scope: 'visitor' | 'global'; resetAt: number }
  /** The retry panel inside the form: the service did not answer as expected. */
  | { kind: 'retry' };

/**
 * Maps any error of POST /api/public/links to its designed state. Everything
 * the page cannot act on, from turnstile_unavailable to a dropped connection,
 * becomes the retry panel. A rate limit without resetAt falls back to the
 * next clock hour, which is when both hourly limits reset.
 */
export function publicErrorState(error: unknown, now: number = Date.now()): PublicErrorState {
  if (!(error instanceof ApiError)) return { kind: 'retry' };
  switch (error.code) {
    case 'invalid_url':
    case 'blocked_domain':
      return { kind: 'field', message: error.message };
    case 'turnstile_failed':
      return { kind: 'turnstile' };
    case 'rate_limited_ip':
      return { kind: 'rate', scope: 'visitor', resetAt: error.resetAt ?? nextHourStart(now) };
    case 'rate_limited_global':
      return { kind: 'rate', scope: 'global', resetAt: error.resetAt ?? nextHourStart(now) };
    default:
      return { kind: 'retry' };
  }
}

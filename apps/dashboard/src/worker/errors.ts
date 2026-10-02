import type { ApiErrorBody, ErrorCode } from '@daffa/shared';
import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

/**
 * Every error the API can return, with its status and default message. The
 * dashboard shows these messages, so they follow the copy rules: formal, no
 * first person, and no em dashes, en dashes or semicolons.
 */
export const ERRORS: Record<ErrorCode, { status: ContentfulStatusCode; message: string }> = {
  bad_request: { status: 400, message: 'The request is not valid.' },
  invalid_id: { status: 400, message: 'The link id must be a positive whole number.' },
  invalid_json: { status: 400, message: 'The request body is not valid JSON.' },
  invalid_field: { status: 400, message: 'The request contains a field that is not valid.' },
  invalid_url: { status: 400, message: 'The destination URL is not valid.' },
  invalid_slug: { status: 400, message: 'The slug is not valid.' },
  forbidden: {
    status: 403,
    message: 'This dashboard requires a valid Cloudflare Access session.',
  },
  csrf_rejected: {
    status: 403,
    message: 'The request was rejected because it did not come from the dashboard.',
  },
  not_found: { status: 404, message: 'The requested resource was not found.' },
  slug_taken: { status: 409, message: 'This slug is already in use.' },
  payload_too_large: { status: 413, message: 'The request body is larger than 16 KB.' },
  internal: { status: 500, message: 'The server could not complete the request.' },
  auth_not_configured: {
    status: 500,
    message: 'Cloudflare Access is not configured for this dashboard.',
  },
  database_unavailable: {
    status: 503,
    message: 'The database did not respond. Short links keep working for visitors.',
  },
  invalid_host: {
    status: 400,
    message: 'The hostname is not valid. Enter a domain name such as example.com.',
  },
  blocked_domain: {
    status: 400,
    message: 'The domain is blocked for public links and cannot be shortened.',
  },
  turnstile_failed: {
    status: 403,
    message: 'Verification failed or expired. Complete the check again, then press Create Link.',
  },
  turnstile_unavailable: {
    status: 503,
    message: 'The verification service did not respond. Try again in a moment.',
  },
  // The two limit messages are the design copy of the rate limit modals.
  rate_limited_ip: {
    status: 429,
    message:
      'Each visitor can create up to 5 public links per hour. Link creation becomes available again at the start of the next hour.',
  },
  rate_limited_global: {
    status: 429,
    message:
      'The shared capacity for public links in this hour has been used by all visitors. Link creation becomes available again for everyone at the start of the next hour.',
  },
  public_not_configured: {
    status: 500,
    message: 'Public link creation is not configured on this server.',
  },
};

/** Extra fields an error may carry next to code and message. */
export type ErrorDetails = Omit<ApiErrorBody['error'], 'code' | 'message'>;

export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly status: ContentfulStatusCode;
  readonly details: ErrorDetails;
  /** Response headers that belong to this error, such as Retry-After on a 429. */
  readonly headers: Record<string, string>;

  constructor(
    code: ErrorCode,
    message?: string,
    details: ErrorDetails = {},
    headers: Record<string, string> = {},
  ) {
    super(message ?? ERRORS[code].message);
    this.name = 'ApiError';
    this.code = code;
    this.status = ERRORS[code].status;
    this.details = details;
    this.headers = headers;
  }
}

export function errorBody(code: ErrorCode, message?: string, details: ErrorDetails = {}): ApiErrorBody {
  return { error: { code, message: message ?? ERRORS[code].message, ...details } };
}

export function errorResponse(
  c: Context,
  code: ErrorCode,
  message?: string,
  details: ErrorDetails = {},
  headers: Record<string, string> = {},
): Response {
  return c.json(errorBody(code, message, details), ERRORS[code].status, headers);
}

/**
 * The single place any thrown error becomes a response. ApiError carries its
 * own code. D1 failures surface as messages starting with "D1_" and become a
 * 503. Anything else is a bug, logged in full and answered with a generic 500.
 */
export function handleError(error: Error, c: Context): Response {
  if (error instanceof ApiError) {
    return errorResponse(c, error.code, error.message, error.details, error.headers);
  }
  if (typeof error.message === 'string' && error.message.startsWith('D1_')) {
    console.error('D1 request failed', error);
    return errorResponse(c, 'database_unavailable');
  }
  console.error('Unhandled API error', error);
  return errorResponse(c, 'internal');
}

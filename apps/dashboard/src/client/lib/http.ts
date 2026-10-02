import type { ApiErrorBody, ErrorCode } from '@daffa/shared';

/**
 * The request core shared by the owner API (lib/api.ts) and the public page
 * (public/api.ts). Each caller passes its own base path, so neither side
 * imports the other's endpoints.
 */

/** The design's error copy promises a 10 second timeout, so the client enforces it. */
const TIMEOUT_MS = 10_000;

export type ClientErrorCode = ErrorCode | 'timeout' | 'network' | 'bad_response';

export interface ApiErrorDetails {
  /** On a public invalid_url: which rule of checkPublicUrl failed. */
  reason?: string;
  /** On rate_limited_ip and rate_limited_global: when creation opens again. */
  resetAt?: number;
  /** Seconds from the Retry-After header, when the response carried one. */
  retryAfter?: number;
}

export class ApiError extends Error {
  readonly code: ClientErrorCode;
  readonly status: number;
  readonly reason?: string;
  readonly resetAt?: number;
  readonly retryAfter?: number;

  constructor(code: ClientErrorCode, message: string, status: number, details: ApiErrorDetails = {}) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.reason = details.reason;
    this.resetAt = details.resetAt;
    this.retryAfter = details.retryAfter;
  }
}

export function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

/**
 * The ApiError for a failed response, from its status, its parsed JSON body
 * (or undefined when the body was not JSON), and its headers. A body without
 * the error shape still yields an error, with the generic code and message.
 */
export function toApiError(status: number, payload: unknown, headers: Pick<Headers, 'get'>): ApiError {
  const error = (payload as Partial<ApiErrorBody> | undefined)?.error;
  const retryHeader = headers.get('Retry-After');
  const retryAfter = retryHeader !== null && /^\d+$/.test(retryHeader) ? Number(retryHeader) : undefined;
  return new ApiError(error?.code ?? 'internal', error?.message ?? 'The request failed.', status, {
    reason: typeof error?.reason === 'string' ? error.reason : undefined,
    resetAt: typeof error?.resetAt === 'number' ? error.resetAt : undefined,
    retryAfter,
  });
}

const MUTATIONS = ['POST', 'PATCH', 'DELETE'];

export async function request<T>(
  base: string,
  method: string,
  path: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const headers: Record<string, string> = { Accept: 'application/json' };
  // The API's CSRF check requires this on every state changing request, with
  // or without a body. The browser adds the Origin header itself.
  if (MUTATIONS.includes(method)) headers['Content-Type'] = 'application/json';

  let response: Response;
  try {
    response = await fetch(`${base}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: combined,
      credentials: 'same-origin',
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    if (timeout.aborted) throw new ApiError('timeout', 'The server did not respond within 10 seconds.', 0);
    throw new ApiError('network', 'The server could not be reached.', 0);
  }

  if (response.status === 204) return undefined as T;

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new ApiError('bad_response', 'The server sent a response that could not be read.', response.status);
  }
  if (!response.ok) throw toApiError(response.status, payload, response.headers);
  return payload as T;
}

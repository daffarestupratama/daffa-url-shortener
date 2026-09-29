import type {
  Analytics,
  ApiErrorBody,
  ClickLogPage,
  ErrorCode,
  Link,
  LinkDetail,
  LinkInput,
  LinkList,
  LinkSort,
  LinkStatusFilter,
  Range,
  SlugAvailability,
  Summary,
} from '@daffa/shared';

/** The design's error copy promises a 10 second timeout, so the client enforces it. */
const TIMEOUT_MS = 10_000;

export type ClientErrorCode = ErrorCode | 'timeout' | 'network' | 'bad_response';

export class ApiError extends Error {
  readonly code: ClientErrorCode;
  readonly status: number;

  constructor(code: ClientErrorCode, message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }
}

export function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

const MUTATIONS = ['POST', 'PATCH', 'DELETE'];

async function request<T>(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const headers: Record<string, string> = { Accept: 'application/json' };
  // The API's CSRF check requires this on every state changing request, with
  // or without a body. The browser adds the Origin header itself.
  if (MUTATIONS.includes(method)) headers['Content-Type'] = 'application/json';

  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
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
  if (!response.ok) {
    const error = (payload as Partial<ApiErrorBody>)?.error;
    throw new ApiError(error?.code ?? 'internal', error?.message ?? 'The request failed.', response.status);
  }
  return payload as T;
}

export interface ListQuery {
  q: string;
  tag: string;
  status: LinkStatusFilter;
  sort: LinkSort;
}

function query(params: Record<string, string | number | null | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value !== undefined && value !== '') search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}

export const api = {
  me: (signal?: AbortSignal) => request<{ email: string }>('GET', '/me', undefined, signal),
  summary: (signal?: AbortSignal) => request<Summary>('GET', '/summary', undefined, signal),
  tags: (signal?: AbortSignal) => request<{ tags: string[] }>('GET', '/tags', undefined, signal),
  links: (q: ListQuery, signal?: AbortSignal) =>
    request<LinkList>(
      'GET',
      `/links${query({ q: q.q, tag: q.tag, status: q.status === 'all' ? null : q.status, sort: q.sort === 'newest' ? null : q.sort })}`,
      undefined,
      signal,
    ),
  link: (id: number, signal?: AbortSignal) => request<LinkDetail>('GET', `/links/${id}`, undefined, signal),
  createLink: (input: LinkInput) => request<{ link: Link }>('POST', '/links', input),
  updateLink: (id: number, input: LinkInput) => request<{ link: Link }>('PATCH', `/links/${id}`, input),
  deleteLink: (id: number) => request<void>('DELETE', `/links/${id}`),
  toggleLink: (id: number) => request<{ link: Link }>('POST', `/links/${id}/toggle`),
  slugAvailable: (slug: string, exclude: number | null, signal?: AbortSignal) =>
    request<SlugAvailability>(
      'GET',
      `/slugs/${encodeURIComponent(slug)}/available${query({ exclude })}`,
      undefined,
      signal,
    ),
  analytics: (id: number, range: Range, signal?: AbortSignal) =>
    request<Analytics>('GET', `/links/${id}/analytics${query({ range })}`, undefined, signal),
  /** `page` is 1 based here and 0 based in the API. */
  clicks: (id: number, range: Range, page: number, signal?: AbortSignal) =>
    request<ClickLogPage>('GET', `/links/${id}/clicks${query({ range, page: page - 1 })}`, undefined, signal),
};

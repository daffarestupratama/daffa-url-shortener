import type {
  Analytics,
  BlockDomainResult,
  BlockedDomainCheck,
  BlockedDomainList,
  ClickLogPage,
  Link,
  LinkDetail,
  LinkInput,
  LinkList,
  LinkSort,
  LinkStatusFilter,
  PublicLinkItem,
  Range,
  SlugAvailability,
  Summary,
  Visibility,
} from '@daffa/shared';
import { request as baseRequest } from './http';

export { ApiError, isAbort, type ClientErrorCode } from './http';

/** The owner API. Dashboard only: the public page has its own public/api.ts. */
const request = <T>(method: string, path: string, body?: unknown, signal?: AbortSignal) =>
  baseRequest<T>('/api/admin', method, path, body, signal);

export interface ListQuery {
  visibility: Visibility;
  q: string;
  tag: string;
  status: LinkStatusFilter;
  sort: LinkSort;
  /** The nextCursor of the previous page, or null for the first page. */
  cursor: string | null;
}

function query(params: Record<string, string | number | null | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value !== undefined && value !== '') search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}

/** The query string of a links page. Defaults are left out, so the first private page is plain /links. */
export function linksQuery(q: ListQuery): string {
  return query({
    visibility: q.visibility === 'private' ? null : q.visibility,
    q: q.q,
    tag: q.tag,
    status: q.status === 'all' ? null : q.status,
    sort: q.sort === 'newest' ? null : q.sort,
    cursor: q.cursor,
  });
}

export const api = {
  me: (signal?: AbortSignal) => request<{ email: string }>('GET', '/me', undefined, signal),
  summary: (signal?: AbortSignal) => request<Summary>('GET', '/summary', undefined, signal),
  tags: (signal?: AbortSignal) => request<{ tags: string[] }>('GET', '/tags', undefined, signal),
  links: (q: ListQuery, signal?: AbortSignal) => request<LinkList>('GET', `/links${linksQuery(q)}`, undefined, signal),
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

  // Moderation of public links. These never edit a public link, only switch or remove it.
  setPublicActive: (id: number, isActive: boolean) =>
    request<{ link: PublicLinkItem }>('PATCH', `/public-links/${id}`, { isActive }),
  deletePublicLink: (id: number) => request<void>('DELETE', `/public-links/${id}`),
  blockedDomains: (q: string, signal?: AbortSignal) =>
    request<BlockedDomainList>('GET', `/blocked-domains${query({ q: q.trim() })}`, undefined, signal),
  checkBlocked: (host: string, signal?: AbortSignal) =>
    request<BlockedDomainCheck>('GET', `/blocked-domains/check${query({ host })}`, undefined, signal),
  blockDomain: (host: string, disableActive: boolean) =>
    request<BlockDomainResult>('POST', '/blocked-domains', { host, disableActive }),
  unblockDomain: (host: string) => request<void>('DELETE', `/blocked-domains/${encodeURIComponent(host)}`),
};

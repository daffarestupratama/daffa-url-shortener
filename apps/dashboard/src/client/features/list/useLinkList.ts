import type { LinkList, LinkListItem, PublicLinkItem, Visibility, VisibilityCount } from '@daffa/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, isAbort, type ListQuery } from '../../lib/api';
import { countsAfterRemove, mergeById } from './listState';

export type ListFilters = Omit<ListQuery, 'cursor'>;

interface State {
  /** Every row loaded so far for the current filters, with the cursor of the next page. */
  data: LinkList | null;
  /** The latest counts of both tabs. Kept across a tab switch, so the tab pills never blank out. */
  counts: Record<Visibility, VisibilityCount> | null;
  /** The first page failed. */
  error: unknown;
  loadingMore: boolean;
  /** The last next page failed. Automatic loading pauses until Load More is pressed. */
  moreFailed: boolean;
}

export interface LinkListApi extends State {
  loadMore: () => void;
  /** Loads the first page again with the same filters, keeping the rows on screen meanwhile. */
  reload: () => void;
  updatePrivate: (update: (links: LinkListItem[]) => LinkListItem[]) => void;
  updatePublic: (update: (links: PublicLinkItem[]) => PublicLinkItem[]) => void;
  /** Drops a deleted row and lowers the counts of its tab. */
  remove: (id: number) => void;
}

/**
 * The links of one tab, page by page through the cursor API. Changing the tab,
 * a filter, the sort or `version` starts again from the first page. Within a
 * tab the old rows stay until the new first page arrives, so filtering never
 * flashes a skeleton. A tab switch clears them, so rows of one tab never sit
 * under the other tab's header. Every response is checked against the request
 * generation, and anything that arrives for an older one is dropped.
 */
export function useLinkList(filters: ListFilters, version: number): LinkListApi {
  const { visibility, q, tag, status, sort } = filters;
  const key = `${visibility}|${q}|${tag}|${status}|${sort}|${version}`;

  const [state, setState] = useState<State>({
    data: null,
    counts: null,
    error: null,
    loadingMore: false,
    moreFailed: false,
  });
  const [attempt, setAttempt] = useState(0);

  const filtersRef = useRef(filters);
  filtersRef.current = filters;
  const stateRef = useRef(state);
  stateRef.current = state;
  const generation = useRef(0);
  const moreBusy = useRef(false);
  const moreController = useRef<AbortController | null>(null);

  useEffect(() => {
    const current = (generation.current += 1);
    const controller = new AbortController();
    const query = filtersRef.current;
    moreController.current?.abort();
    moreBusy.current = false;

    setState((s) => ({
      ...s,
      data: s.data?.visibility === query.visibility ? s.data : null,
      error: null,
      loadingMore: false,
      moreFailed: false,
    }));

    api.links({ ...query, cursor: null }, controller.signal).then(
      (data) => {
        if (current !== generation.current) return;
        setState((s) => ({ ...s, data, counts: data.counts, error: null }));
      },
      (error: unknown) => {
        if (current !== generation.current || isAbort(error)) return;
        setState((s) => ({ ...s, error }));
      },
    );
    return () => controller.abort();
  }, [key, attempt]);

  const loadMore = useCallback(() => {
    const cursor = stateRef.current.data?.nextCursor;
    if (!cursor || moreBusy.current) return;
    moreBusy.current = true;
    const current = generation.current;
    const controller = new AbortController();
    moreController.current = controller;
    setState((s) => ({ ...s, loadingMore: true, moreFailed: false }));

    api.links({ ...filtersRef.current, cursor }, controller.signal).then(
      (page) => {
        if (current !== generation.current) return;
        moreBusy.current = false;
        setState((s) => {
          if (!s.data || s.data.visibility !== page.visibility) return { ...s, loadingMore: false };
          const data =
            page.visibility === 'private' && s.data.visibility === 'private'
              ? { ...page, links: mergeById(s.data.links, page.links) }
              : page.visibility === 'public' && s.data.visibility === 'public'
                ? { ...page, links: mergeById(s.data.links, page.links) }
                : s.data;
          return { ...s, data, counts: page.counts, loadingMore: false };
        });
      },
      (error: unknown) => {
        if (current !== generation.current || isAbort(error)) return;
        moreBusy.current = false;
        setState((s) => ({ ...s, loadingMore: false, moreFailed: true }));
      },
    );
  }, []);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);

  const updatePrivate = useCallback((update: (links: LinkListItem[]) => LinkListItem[]) => {
    setState((s) =>
      s.data?.visibility === 'private' ? { ...s, data: { ...s.data, links: update(s.data.links) } } : s,
    );
  }, []);

  const updatePublic = useCallback((update: (links: PublicLinkItem[]) => PublicLinkItem[]) => {
    setState((s) =>
      s.data?.visibility === 'public' ? { ...s, data: { ...s.data, links: update(s.data.links) } } : s,
    );
  }, []);

  const remove = useCallback((id: number) => {
    setState((s) => {
      if (!s.data) return s;
      const counts = s.counts ? countsAfterRemove(s.counts, s.data.visibility) : s.counts;
      const data: LinkList =
        s.data.visibility === 'private'
          ? { ...s.data, links: s.data.links.filter((link) => link.id !== id) }
          : { ...s.data, links: s.data.links.filter((link) => link.id !== id) };
      return { ...s, data: counts ? { ...data, counts } : data, counts };
    });
  }, []);

  return { ...state, loadMore, reload, updatePrivate, updatePublic, remove };
}

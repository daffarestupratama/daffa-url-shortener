import { createElement, useSyncExternalStore, type AnchorHTMLAttributes, type MouseEvent } from 'react';

/**
 * A router of about sixty lines on top of the History API. The dashboard has
 * two pages, so a routing library would cost more than it saves. Deep links
 * such as /links/1?range=7d survive a refresh because the Worker serves
 * index.html for every non API path (not_found_handling: single-page-application).
 */

const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

if (typeof window !== 'undefined') {
  window.addEventListener('popstate', notify);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function snapshot(): string {
  return window.location.pathname + window.location.search;
}

export interface Location {
  path: string;
  search: string;
}

export function useLocation(): Location {
  const href = useSyncExternalStore(subscribe, snapshot, () => '/');
  const queryAt = href.indexOf('?');
  return queryAt === -1
    ? { path: href, search: '' }
    : { path: href.slice(0, queryAt), search: href.slice(queryAt) };
}

export interface NavigateOptions {
  /** Replace the current history entry, used for filter changes. */
  replace?: boolean;
}

export function navigate(to: string, { replace = false }: NavigateOptions = {}): void {
  if (to === snapshot()) return;
  if (replace) window.history.replaceState(null, '', to);
  else window.history.pushState(null, '', to);
  notify();
  if (!replace) window.scrollTo(0, 0);
}

type LinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & { to: string };

/** A real anchor, so ctrl, cmd, shift and middle click still open a new tab. */
export function Link({ to, onClick, ...rest }: LinkProps) {
  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey ||
      rest.target
    ) {
      return;
    }
    event.preventDefault();
    navigate(to);
  };
  return createElement('a', { ...rest, href: to, onClick: handleClick });
}

/** The raw id segment of /links/:id, or null for any other path. */
export function matchDetail(path: string): string | null {
  const match = /^\/links\/([^/]+)\/?$/.exec(path);
  return match ? decodeURIComponent(match[1]!) : null;
}

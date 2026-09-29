import { useCallback } from 'react';
import { navigate, useLocation } from './router';

/**
 * Page state that lives in the query string, so filters and ranges survive a
 * refresh and can be shared as a link. Defaults are never written, which keeps
 * URLs short: the list with no filters is simply "/".
 */

/** Returns `value` when it is one of `allowed`, else the fallback. Invalid URL input never reaches the API. */
export function pickEnum<T extends string>(value: string | null, allowed: readonly T[], fallback: T): T {
  return value !== null && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

/** A positive whole number from the URL, else the fallback. */
export function pickPositiveInt(value: string | null, fallback: number): number {
  if (value === null || !/^[1-9][0-9]{0,6}$/.test(value)) return fallback;
  return Number(value);
}

/**
 * The search string after setting several keys. A value equal to its default,
 * or empty, removes the key. Keys keep their existing order.
 */
export function withParams(
  search: string,
  updates: Record<string, { value: string; fallback: string }>,
): string {
  const params = new URLSearchParams(search);
  for (const [key, { value, fallback }] of Object.entries(updates)) {
    if (value === '' || value === fallback) params.delete(key);
    else params.set(key, value);
  }
  const text = params.toString();
  return text ? `?${text}` : '';
}

/** Reads and writes query parameters of the current page. Writes replace the history entry. */
export function useSearchParams(): {
  params: URLSearchParams;
  path: string;
  search: string;
  update: (updates: Record<string, { value: string; fallback: string }>) => void;
} {
  const { path, search } = useLocation();
  const update = useCallback(
    (updates: Record<string, { value: string; fallback: string }>) => {
      navigate(`${path}${withParams(window.location.search, updates)}`, { replace: true });
    },
    [path],
  );
  return { params: new URLSearchParams(search), path, search, update };
}

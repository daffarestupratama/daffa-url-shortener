import { useCallback, useEffect, useRef, useState } from 'react';

export interface Resource<T> {
  data: T | null;
  error: unknown;
  /** True while a request is in flight, including refreshes that keep old data on screen. */
  loading: boolean;
  /** True only before the first response: the moment to show skeletons. */
  initial: boolean;
  reload: () => void;
}

/**
 * Fetches whenever `key` changes. The previous request is aborted, and the
 * previous data stays on screen until the new data arrives, so changing a
 * filter or a range never flashes a skeleton. A null key pauses fetching.
 */
export function useResource<T>(
  key: string | null,
  load: (signal: AbortSignal) => Promise<T>,
): Resource<T> {
  const [state, setState] = useState<{ data: T | null; error: unknown; loading: boolean; settled: boolean }>({
    data: null,
    error: null,
    loading: key !== null,
    settled: false,
  });
  const [attempt, setAttempt] = useState(0);
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    if (key === null) return;
    const controller = new AbortController();
    setState((s) => ({ ...s, loading: true }));
    loadRef.current(controller.signal).then(
      (data) => {
        if (!controller.signal.aborted) setState({ data, error: null, loading: false, settled: true });
      },
      (error: unknown) => {
        if (!controller.signal.aborted) setState((s) => ({ ...s, error, loading: false, settled: true }));
      },
    );
    return () => controller.abort();
  }, [key, attempt]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  return { data: state.data, error: state.error, loading: state.loading, initial: !state.settled, reload };
}

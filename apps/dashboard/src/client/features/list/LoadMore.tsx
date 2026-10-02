import { useEffect, useRef } from 'react';
import { Button } from '../../components/controls';
import { showingText } from './listState';
import styles from './list.module.css';

interface LoadMoreProps {
  loaded: number;
  matching: number;
  loading: boolean;
  /** After a failed page, only the button loads again, never the observer. */
  paused: boolean;
  onLoad: () => void;
}

/**
 * The footer under the rows while more pages follow. An IntersectionObserver
 * asks for the next page 120 px before the footer scrolls into view, and the
 * Load More button does the same for keyboard users and older browsers. When
 * a page lands and the footer is still visible, the next one is requested.
 */
export function LoadMore({ loaded, matching, loading, paused, onLoad }: LoadMoreProps) {
  const ref = useRef<HTMLDivElement>(null);
  const visible = useRef(false);
  const onLoadRef = useRef(onLoad);
  onLoadRef.current = onLoad;
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  useEffect(() => {
    const element = ref.current;
    if (!element || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          visible.current = entry.isIntersecting;
          if (entry.isIntersecting && !pausedRef.current) onLoadRef.current();
        }
      },
      { rootMargin: '120px' },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!loading && !paused && visible.current) onLoadRef.current();
  }, [loading, paused, loaded]);

  return (
    <div ref={ref} className={styles.loadMore}>
      <span className={styles.loadMoreText}>{showingText(loaded, matching)}</span>
      <Button
        variant="secondary"
        size="md"
        className={styles.loadMoreButton}
        disabled={loading}
        aria-busy={loading}
        onClick={onLoad}
      >
        {loading ? 'Loading links' : 'Load More'}
      </Button>
    </div>
  );
}

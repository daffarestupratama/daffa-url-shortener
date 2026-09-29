import { Panel, Skeleton } from '../../components/surfaces';
import styles from './skeleton.module.css';

/**
 * Loading state for the detail page. It lives in the main bundle because it is
 * also the fallback while the lazily loaded detail page code arrives.
 */
export function DetailSkeleton() {
  return (
    <>
      <Skeleton width={120} height={40} radius={12} tone={2} />
      <Panel className={styles.header} aria-busy="true" aria-label="Loading link">
        <div className={styles.line}>
          <Skeleton width={260} height={60} radius={12} />
          <Skeleton width={90} height={44} radius={12} tone={2} />
          <Skeleton width={110} height={44} radius={12} tone={2} />
          <Skeleton width={70} height={44} radius={12} tone={2} />
        </div>
        <Skeleton width="40%" height={16} tone={2} />
        <Skeleton width="55%" height={24} />
        <Skeleton width="70%" height={14} tone={2} />
      </Panel>
      <div className={styles.kpis}>
        {[1, 2, 3, 4].map((n) => (
          <Panel key={n} className={styles.card}>
            <Skeleton width="50%" height={11} />
            <Skeleton width="40%" height={40} tone={2} />
            <Skeleton width="60%" height={14} />
          </Panel>
        ))}
      </div>
    </>
  );
}

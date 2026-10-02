import { Button } from '../../components/controls';
import { Panel, PanelHeader, Skeleton } from '../../components/surfaces';
import { Badge, GateTile } from '../../components/tiles';
import { ApiError } from '../../lib/api';
import styles from './list.module.css';

const cx = (...names: Array<string | false | null | undefined>) => names.filter(Boolean).join(' ');

export function LoadingPanel() {
  return (
    <Panel aria-busy="true" aria-label="Loading links">
      <PanelHeader>LOADING LINKS</PanelHeader>
      {[1, 2, 3, 4, 5].map((n) => (
        // Same columns and heights as LinkRow, so nothing moves when rows arrive.
        <div key={n} className={styles.skeletonRow}>
          <span className={styles.slugCell}>
            <Skeleton width={64} height={23} />
            <span className={styles.slugLine}>
              <Skeleton width={144} height={36} radius={8} />
              <Skeleton width={36} height={36} radius={10} tone={2} />
            </span>
            <Skeleton width={110} height={16} tone={2} />
          </span>
          <span className={styles.skeletonText}>
            <Skeleton width="45%" height={14} />
            <Skeleton width="75%" height={12} tone={2} />
          </span>
          <span className={styles.clicks}>
            <Skeleton width={44} height={24} />
            <Skeleton width={36} height={12} tone={2} />
          </span>
          <span className={styles.actions}>
            <Skeleton width={184} height={40} radius={12} tone={2} />
          </span>
        </div>
      ))}
    </Panel>
  );
}

export function ErrorPanel({ error, onReload }: { error: unknown; onReload: () => void }) {
  const status = error instanceof ApiError && error.status >= 500 ? error.status : 503;
  return (
    <Panel role="alert" className={cx(styles.statePanel, styles.stateStart)}>
      <Badge tone="danger" size="md">
        ERROR {'·'} {status}
      </Badge>
      <h2 className={styles.h2}>Links failed to load</h2>
      <p className={cx(styles.stateText, styles.stateTextWide)}>
        The server did not respond within 10 seconds. Short links keep working for visitors. Check your internet
        connection, then reload the page.
      </p>
      <Button variant="secondary" size="md" onClick={onReload}>
        Reload
      </Button>
    </Panel>
  );
}

export function EmptyPanel({ onCreate }: { onCreate: () => void }) {
  return (
    <Panel className={cx(styles.statePanel, styles.stateCenter)}>
      <GateTile slug="_ _ _" variant="empty" />
      <h2 className={styles.h2}>No links yet</h2>
      <p className={styles.stateText}>The first link will appear here with its click count, status, and QR code.</p>
      <Button variant="primary" onClick={onCreate}>
        Create First Link
      </Button>
    </Panel>
  );
}

export function NoResultsPanel({ onReset }: { onReset: () => void }) {
  return (
    <Panel className={cx(styles.statePanel, styles.stateCenter, styles.stateNoResults)}>
      <h2 className={cx(styles.h2, styles.h2Small)}>No matching links</h2>
      <p className={cx(styles.stateText, styles.stateTextSmall)}>Try another keyword or reset the tag and status filters.</p>
      <Button variant="secondary" size="md" onClick={onReset}>
        Reset Filters
      </Button>
    </Panel>
  );
}

export function PublicEmptyPanel() {
  return (
    <Panel className={cx(styles.statePanel, styles.stateCenter, styles.statePublicEmpty)}>
      <GateTile slug="_ _ _ _ _ _" variant="empty" className={styles.emptyTileSmall} />
      <h2 className={cx(styles.h2, styles.h2Small)}>No public links yet</h2>
      <p className={cx(styles.stateText, styles.stateTextSmall, styles.stateTextNarrow)}>
        Links created by visitors on link.daffa.me will appear here with their slug, destination, and daily clicks.
      </p>
    </Panel>
  );
}

export function PublicNoResultsPanel({ onReset }: { onReset: () => void }) {
  return (
    <Panel className={cx(styles.statePanel, styles.stateCenter, styles.stateNoResults, styles.statePublicNoResults)}>
      <h2 className={cx(styles.h2, styles.h2Smaller)}>No matching public links</h2>
      <p className={cx(styles.stateText, styles.stateTextSmall)}>
        Try another keyword or reset the status filter. Public links have no expiration.
      </p>
      <Button variant="secondary" size="md" onClick={onReset}>
        Reset Filters
      </Button>
    </Panel>
  );
}

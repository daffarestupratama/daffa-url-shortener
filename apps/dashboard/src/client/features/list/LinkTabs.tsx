import type { Visibility, VisibilityCount } from '@daffa/shared';
import type { KeyboardEvent } from 'react';
import { formatNumber } from '../../lib/format';
import styles from './list.module.css';

const TABS: ReadonlyArray<readonly [Visibility, string]> = [
  ['private', 'Private Links'],
  ['public', 'Public Links'],
];

export const TAB_PANEL_ID = 'links-panel';

export const tabId = (visibility: Visibility) => `links-tab-${visibility}`;

interface LinkTabsProps {
  value: Visibility;
  /** Null before the first response, shown as an ellipsis. */
  counts: Record<Visibility, VisibilityCount> | null;
  onChange: (value: Visibility) => void;
}

/**
 * Private and Public tabs under the one shared toolbar. The pills count the
 * links that match the current filters. Arrow keys, Home and End switch tabs
 * directly, as with the segmented controls.
 */
export function LinkTabs({ value, counts, onChange }: LinkTabsProps) {
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End'];
    if (!keys.includes(event.key)) return;
    event.preventDefault();
    const index = TABS.findIndex(([key]) => key === value);
    const step = event.key === 'ArrowRight' ? 1 : -1;
    const next =
      event.key === 'Home' ? 0 : event.key === 'End' ? TABS.length - 1 : (index + step + TABS.length) % TABS.length;
    const target = TABS[next]![0];
    onChange(target);
    document.getElementById(tabId(target))?.focus();
  };

  return (
    <div role="tablist" aria-label="Link tables" className={styles.tabs} onKeyDown={onKeyDown}>
      {TABS.map(([key, label]) => {
        const selected = key === value;
        return (
          <button
            key={key}
            id={tabId(key)}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls={TAB_PANEL_ID}
            tabIndex={selected ? 0 : -1}
            className={styles.tab}
            onClick={() => onChange(key)}
          >
            {label}
            <span className={styles.tabCount}>{counts ? formatNumber(counts[key].matching) : '…'}</span>
          </button>
        );
      })}
    </div>
  );
}

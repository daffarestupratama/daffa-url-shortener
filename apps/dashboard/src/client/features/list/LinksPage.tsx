import type { LinkSort, LinkStatusFilter, Summary } from '@daffa/shared';
import { useEffect, useRef, useState } from 'react';
import { Button, Dropdown, SegmentedControl } from '../../components/controls';
import { SearchIcon } from '../../components/Icons';
import { KpiCard, Panel, PanelHeader, Skeleton } from '../../components/surfaces';
import { Badge, GateTile } from '../../components/tiles';
import { api, ApiError } from '../../lib/api';
import { formatDateRange, formatNumber } from '../../lib/format';
import { applyListOverlay, listFlags } from '../../lib/preview';
import { pickEnum, useSearchParams } from '../../lib/useQuery';
import { useResource } from '../../lib/useResource';
import { useApp } from '../app/AppProvider';
import { LinkRow } from './LinkRow';
import styles from './list.module.css';

const cx = (...names: Array<string | false | null | undefined>) => names.filter(Boolean).join(' ');

const STATUSES: ReadonlyArray<readonly [LinkStatusFilter, string]> = [
  ['all', 'All'],
  ['active', 'Active'],
  ['inactive', 'Inactive'],
  ['expired', 'Expired'],
];
const STATUS_KEYS = STATUSES.map(([key]) => key);

const SORTS: ReadonlyArray<readonly [LinkSort, string]> = [
  ['newest', 'Sort: Newest'],
  ['oldest', 'Sort: Oldest'],
  ['clicks', 'Sort: Most clicks'],
  ['least', 'Sort: Least clicks'],
];
const SORT_KEYS = SORTS.map(([key]) => key);

/** The list query the detail page's "All Links" button returns to. */
let lastListSearch = '';
export function listPathWithFilters(): string {
  return `/${lastListSearch}`;
}

export function LinksPage() {
  const app = useApp();
  const { params, search, update } = useSearchParams();
  const flags = listFlags(search);
  const remembered = new URLSearchParams(search);
  remembered.delete('state');
  remembered.delete('overlay');
  lastListSearch = remembered.size > 0 ? `?${remembered.toString()}` : '';

  const q = params.get('q') ?? '';
  const tag = params.get('tag') ?? '';
  const status = pickEnum(params.get('status'), STATUS_KEYS, 'all');
  const sort = pickEnum(params.get('sort'), SORT_KEYS, 'newest');

  // The search box types into local state and reaches the URL 250 ms later.
  const [searchText, setSearchText] = useState(q);
  useEffect(() => setSearchText(q), [q]);
  useEffect(() => {
    if (searchText === q) return;
    const timer = window.setTimeout(() => update({ q: { value: searchText.trim(), fallback: '' } }), 250);
    return () => window.clearTimeout(timer);
  }, [searchText, q, update]);

  const summary = useResource(`summary:${app.version}`, (signal) => api.summary(signal));
  const tags = useResource(`tags:${app.version}`, (signal) => api.tags(signal));
  const links = useResource(`links:${q}|${tag}|${status}|${sort}|${app.version}`, (signal) =>
    api.links({ q, tag, status, sort }, signal),
  );

  // Dev only: open an overlay from the URL once the data it needs has loaded.
  // In production applyListOverlay is a constant that returns true.
  const previewDone = useRef(false);
  const firstLink = links.data?.links[0] ?? null;
  useEffect(() => {
    if (!previewDone.current) previewDone.current = applyListOverlay(search, app, firstLink);
  }, [search, firstLink, app]);

  const forced = flags.loading || flags.error || flags.empty || flags.noResults;
  const loading = flags.loading || (!forced && links.initial);
  const failed = flags.error || (!forced && !loading && links.error !== null && links.data === null);
  const total = flags.empty ? 0 : (links.data?.total ?? 0);
  const rows = flags.noResults ? [] : (links.data?.links ?? []);
  const empty = !loading && !failed && total === 0;
  const noResults = !loading && !failed && total > 0 && rows.length === 0;
  const normal = !loading && !failed && !empty;

  const allTags = tags.data?.tags ?? [];
  const tagOptions: ReadonlyArray<readonly [string, string]> = [
    ['', 'All tags'],
    ...allTags.map((name) => [name, `#${name}`] as const),
    ...(tag && !allTags.includes(tag) ? [[tag, `#${tag}`] as const] : []),
  ];

  const resetFilters = () =>
    update({
      q: { value: '', fallback: '' },
      tag: { value: '', fallback: '' },
      status: { value: 'all', fallback: 'all' },
    });

  const reload = () => {
    links.reload();
    summary.reload();
  };

  return (
    <>
      <div className={styles.pageHead}>
        <div className={styles.titleBlock}>
          <h1 className={styles.h1}>
            <span className={styles.h1Marker} aria-hidden="true" />
            Links
          </h1>
          <p className={styles.lede}>All short links on daffa.me with a summary of clicks over the last 7 days.</p>
        </div>
        <Button variant="primary" onClick={() => app.openCreate()}>
          <span className={styles.plus} aria-hidden="true">
            +
          </span>
          Create Link
        </Button>
      </div>

      {normal && <KpiRow summary={summary.data} />}

      {normal && (
        <div className={styles.toolbar}>
          <label className={styles.search}>
            <span className="visually-hidden">Search links</span>
            <SearchIcon className={styles.searchIcon} />
            <input
              type="search"
              className={styles.searchInput}
              value={searchText}
              placeholder="Search slug, title, or destination URL"
              onChange={(event) => setSearchText(event.target.value)}
            />
          </label>
          <Dropdown
            label="Filter by tag"
            options={tagOptions}
            value={tag}
            onChange={(value) => update({ tag: { value, fallback: '' } })}
            defaultOpen={flags.tagOpen}
          />
          <SegmentedControl
            label="Filter by status"
            options={STATUSES}
            value={status}
            compact
            onChange={(value) => update({ status: { value, fallback: 'all' } })}
          />
          <Dropdown
            label="Sort order"
            options={SORTS}
            value={sort}
            align="right"
            onChange={(value) => update({ sort: { value, fallback: 'newest' } })}
            defaultOpen={flags.sortOpen}
          />
        </div>
      )}

      {loading && <LoadingPanel />}
      {failed && <ErrorPanel error={links.error} onReload={reload} />}
      {empty && <EmptyPanel onCreate={() => app.openCreate()} />}
      {noResults && <NoResultsPanel onReset={resetFilters} />}

      {normal && !noResults && (
        <Panel aria-label="Links">
          <PanelHeader>
            <span>
              {formatNumber(rows.length)} OF {formatNumber(total)} LINKS
            </span>
            <span>HUMAN CLICKS {'·'} 7 DAYS</span>
          </PanelHeader>
          {rows.map((link, index) => (
            <LinkRow key={link.id} link={link} defaultMenuOpen={index === 0 && flags.menuOpen} />
          ))}
        </Panel>
      )}
    </>
  );
}

function KpiRow({ summary }: { summary: Summary | null }) {
  const value = (n: number | undefined) => (n === undefined ? '…' : formatNumber(n));
  const range = summary ? formatDateRange(summary.windowStart, summary.windowEnd) : ' ';
  return (
    <div className={styles.kpis}>
      <KpiCard label="ACTIVE LINKS" value={value(summary?.active)} foot={`of ${value(summary?.total)} saved links`} />
      <KpiCard label={`HUMAN CLICKS · 7 DAYS`} value={value(summary?.human7d)} foot={range} />
      <KpiCard
        label={`UNIQUE VISITORS · 7 DAYS`}
        value={value(summary?.unique7d)}
        tone="link"
        foot="based on IP address and device"
      />
      <KpiCard
        label={`MOST CLICKED · 7 DAYS`}
        value={
          summary?.top ? (
            <span className={styles.topRow}>
              <GateTile slug={summary.top.slug} variant="kpi" />
              <span className={styles.topClicks}>{formatNumber(summary.top.clicks)}</span>
            </span>
          ) : (
            <span className={styles.topClicks}>{summary ? '0' : '…'}</span>
          )
        }
        foot={summary?.top ? `${summary.top.title} · human clicks` : 'No human clicks in the last 7 days'}
      />
    </div>
  );
}

function LoadingPanel() {
  return (
    <Panel aria-busy="true" aria-label="Loading links">
      <PanelHeader>LOADING LINKS</PanelHeader>
      {[1, 2, 3, 4, 5].map((n) => (
        <div key={n} className={styles.skeletonRow}>
          <Skeleton width={120} height={36} radius={8} />
          <span className={styles.skeletonText}>
            <Skeleton width="45%" height={14} />
            <Skeleton width="75%" height={12} tone={2} />
          </span>
          <Skeleton width={70} height={24} />
          <Skeleton width={90} height={24} tone={2} />
          <Skeleton width={170} height={40} radius={12} tone={2} />
        </div>
      ))}
    </Panel>
  );
}

function ErrorPanel({ error, onReload }: { error: unknown; onReload: () => void }) {
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

function EmptyPanel({ onCreate }: { onCreate: () => void }) {
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

function NoResultsPanel({ onReset }: { onReset: () => void }) {
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

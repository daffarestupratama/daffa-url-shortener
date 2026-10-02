import {
  isOnDomain,
  type BlockDomainResult,
  type BlockedDomainCheck,
  type BlockedDomainList,
  type Link,
  type LinkSort,
  type LinkStatusFilter,
  type PublicLinkItem,
  type Summary,
  type Visibility,
} from '@daffa/shared';
import { useEffect, useRef, useState } from 'react';
import { Button, Dropdown, SegmentedControl } from '../../components/controls';
import { BlockIcon, SearchIcon } from '../../components/Icons';
import { KpiCard } from '../../components/surfaces';
import { GateTile } from '../../components/tiles';
import { api } from '../../lib/api';
import { formatDateRange, formatNumber } from '../../lib/format';
import { applyListOverlay, listFlags } from '../../lib/preview';
import { DASHBOARD_BASE } from '../../lib/router';
import { pickEnum, useSearchParams } from '../../lib/useQuery';
import { useResource } from '../../lib/useResource';
import { useApp } from '../app/AppProvider';
import { BlockDomainDialog } from '../moderation/BlockDomainDialog';
import { BlockedDomainsModal } from '../moderation/BlockedDomainsModal';
import { PublicDeleteDialog } from '../moderation/PublicDeleteDialog';
import { BudgetKpi } from './BudgetKpi';
import { LinkTabs, TAB_PANEL_ID, tabId } from './LinkTabs';
import { patchById } from './listState';
import {
  EmptyPanel,
  ErrorPanel,
  LoadingPanel,
  NoResultsPanel,
  PublicEmptyPanel,
  PublicNoResultsPanel,
} from './ListStates';
import { PrivateTable, PublicTable, type Paging } from './Tables';
import { useLinkList } from './useLinkList';
import styles from './list.module.css';

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

const TAB_KEYS: readonly Visibility[] = ['private', 'public'];

const TAB_DESCRIPTION: Record<Visibility, string> = {
  private: 'Created by the owner. Custom slugs, tags, expiration, and full analytics.',
  public: 'Created by visitors on link.daffa.me. Permanent, with click counts only.',
};

/** The list query the detail page's "All Links" button returns to, the tab included. */
let lastListSearch = '';
export function listPathWithFilters(): string {
  return `${DASHBOARD_BASE}${lastListSearch}`;
}

type Moderation =
  | { kind: 'delete'; link: PublicLinkItem; preview?: boolean }
  | { kind: 'block'; host: string; forced?: BlockedDomainCheck; preview?: boolean }
  | null;

interface BlockedModalState {
  query: string;
  forced?: BlockedDomainList;
}

export function LinksPage() {
  const app = useApp();
  const { params, search, update } = useSearchParams();
  const flags = listFlags(search);
  const remembered = new URLSearchParams(search);
  remembered.delete('state');
  remembered.delete('overlay');
  lastListSearch = remembered.size > 0 ? `?${remembered.toString()}` : '';

  const tab = pickEnum(params.get('tab'), TAB_KEYS, 'private');
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
  const [blockedVersion, setBlockedVersion] = useState(0);
  const blocked = useResource(`blocked:${blockedVersion}:${app.version}`, (signal) => api.blockedDomains('', signal));
  const list = useLinkList({ visibility: tab, q, tag, status, sort }, app.version);

  const [moderation, setModeration] = useState<Moderation>(null);
  const [blockedModal, setBlockedModal] = useState<BlockedModalState | null>(null);

  const data = list.data?.visibility === tab ? list.data : null;
  const firstPrivate = data?.visibility === 'private' ? (data.links[0] ?? null) : null;
  const firstPublic = data?.visibility === 'public' ? (data.links[0] ?? null) : null;

  // Dev only: open an overlay from the URL once the rows it needs have loaded.
  // In production applyListOverlay is a constant that returns true.
  const previewDone = useRef(false);
  useEffect(() => {
    if (previewDone.current) return;
    previewDone.current = applyListOverlay(
      search,
      {
        ...app,
        openPublicDelete: (link) => setModeration({ kind: 'delete', link, preview: true }),
        openBlock: (host, forced) => setModeration({ kind: 'block', host, forced, preview: true }),
        openBlocked: ({ query = '', forced }) => setBlockedModal({ query, forced }),
      },
      { privateLink: firstPrivate, publicLink: firstPublic },
    );
  }, [search, firstPrivate, firstPublic, app]);

  // Automatic loading pauses after a failed page, and the toast says how to resume.
  const { toast } = app;
  useEffect(() => {
    if (list.moreFailed) toast('More links could not be loaded. Press Load More to try again.');
  }, [list.moreFailed, toast]);

  const counts = list.counts;
  const forced = flags.loading || flags.error || flags.empty || flags.noResults;
  const loading = flags.loading || (!forced && data === null && list.error === null);
  const failed = flags.error || (!forced && data === null && list.error !== null);
  const total = flags.empty ? 0 : (counts?.[tab].total ?? 0);
  const rowsShown = data !== null && !flags.empty && !flags.noResults;
  const rowCount = rowsShown ? data.links.length : 0;
  const empty = !loading && !failed && total === 0;
  const noResults = !loading && !failed && total > 0 && rowCount === 0;
  const showRows = !loading && !failed && !empty && !noResults && rowsShown;

  const privateTotal = counts?.private.total ?? 0;
  const publicTotal = counts?.public.total ?? 0;
  const emptyPrivatePreview = flags.empty && tab === 'private';
  const settled = counts !== null && !flags.loading && !flags.error;
  const showKpi = settled && privateTotal > 0 && !emptyPrivatePreview;
  const showToolbar = settled && privateTotal + publicTotal > 0 && !emptyPrivatePreview;

  const summaryData: Summary | null =
    summary.data && flags.budgetShare !== null
      ? { ...summary.data, publicClicksToday: Math.round(summary.data.publicDailyBudget * flags.budgetShare) }
      : summary.data;

  const allTags = tags.data?.tags ?? [];
  const tagOptions: ReadonlyArray<readonly [string, string]> = [
    ['', 'All tags'],
    ...allTags.map((name) => [name, `#${name}`] as const),
    ...(tag && !allTags.includes(tag) ? [[tag, `#${tag}`] as const] : []),
  ];

  const resetFilters = () =>
    update({
      q: { value: '', fallback: '' },
      ...(tab === 'private' ? { tag: { value: '', fallback: '' } } : {}),
      status: { value: 'all', fallback: 'all' },
    });

  const reload = () => {
    list.reload();
    summary.reload();
  };

  const paging: Paging = {
    matching: flags.noResults ? 0 : (counts?.[tab].matching ?? 0),
    total,
    hasMore: flags.loadingMore || Boolean(data?.nextCursor),
    loadingMore: flags.loadingMore || list.loadingMore,
    paused: flags.loadingMore || list.moreFailed,
    onLoadMore: flags.loadingMore ? () => undefined : list.loadMore,
  };

  const onPrivateToggled = (link: Link) => {
    list.updatePrivate((links) => patchById(links, link.id, (old) => ({ ...old, ...link })));
    summary.reload();
  };

  const onPublicUpdated = (link: PublicLinkItem) => {
    list.updatePublic((links) => patchById(links, link.id, () => link));
    summary.reload();
  };

  /** Marks loaded rows on the blocked domain, and switches them off when the block did. */
  const onBlocked = (result: BlockDomainResult, disableActive: boolean) => {
    const host = result.domain.host;
    list.updatePublic((links) =>
      links.map((link) => {
        if (!isOnDomain(link.host, host)) return link;
        const off = disableActive && link.isActive;
        return { ...link, domainBlocked: true, ...(off ? { isActive: false, status: 'inactive' as const } : {}) };
      }),
    );
    setBlockedVersion((v) => v + 1);
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

      {showKpi && <KpiRow summary={summaryData} />}

      {showToolbar && (
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
          <Button variant="secondary" className={styles.blockedButton} onClick={() => setBlockedModal({ query: '' })}>
            <BlockIcon />
            Blocked Domains
            <span className={styles.pill}>{blocked.data ? formatNumber(blocked.data.total) : '…'}</span>
          </Button>
        </div>
      )}

      <div className={styles.tabRow}>
        <LinkTabs
          value={tab}
          counts={counts}
          onChange={(value) => update({ tab: { value, fallback: 'private' } })}
        />
        <span className={styles.tabDesc}>{TAB_DESCRIPTION[tab]}</span>
      </div>

      <div id={TAB_PANEL_ID} role="tabpanel" aria-labelledby={tabId(tab)}>
        {loading && <LoadingPanel />}
        {failed && <ErrorPanel error={list.error} onReload={reload} />}
        {empty && (tab === 'private' ? <EmptyPanel onCreate={() => app.openCreate()} /> : <PublicEmptyPanel />)}
        {noResults &&
          (tab === 'private' ? (
            <NoResultsPanel onReset={resetFilters} />
          ) : (
            <PublicNoResultsPanel onReset={resetFilters} />
          ))}
        {showRows && data?.visibility === 'private' && (
          <PrivateTable links={data.links} paging={paging} onToggled={onPrivateToggled} menuOpenFirst={flags.menuOpen} />
        )}
        {showRows && data?.visibility === 'public' && (
          <PublicTable
            links={
              flags.menuBlocked
                ? data.links.map((link, index) => (index === 0 ? { ...link, domainBlocked: true } : link))
                : data.links
            }
            paging={paging}
            tagFiltered={tag !== ''}
            onUpdated={onPublicUpdated}
            onBlock={(link) => setModeration({ kind: 'block', host: link.host })}
            onShowBlocked={(host) => setBlockedModal({ query: host })}
            onDelete={(link) => setModeration({ kind: 'delete', link })}
            menuOpenFirst={flags.menuOpen}
          />
        )}
      </div>

      {moderation?.kind === 'delete' && (
        <PublicDeleteDialog
          link={moderation.link}
          preview={moderation.preview}
          onClose={() => setModeration(null)}
          onDeleted={(id) => {
            setModeration(null);
            list.remove(id);
            summary.reload();
          }}
          onDisabled={(link) => {
            setModeration(null);
            onPublicUpdated(link);
          }}
        />
      )}
      {moderation?.kind === 'block' && (
        <BlockDomainDialog
          host={moderation.host}
          forced={moderation.forced}
          preview={moderation.preview}
          onClose={() => setModeration(null)}
          onBlocked={(result, disableActive) => {
            setModeration(null);
            onBlocked(result, disableActive);
          }}
        />
      )}
      {blockedModal && (
        <BlockedDomainsModal
          initialQuery={blockedModal.query}
          forced={blockedModal.forced}
          onClose={(changed) => {
            setBlockedModal(null);
            // Another entry may still cover a host, so the rows come fresh from the API.
            if (changed && tab === 'public') list.reload();
          }}
          onBlocked={onBlocked}
          onRemoved={() => setBlockedVersion((v) => v + 1)}
        />
      )}
    </>
  );
}

function KpiRow({ summary }: { summary: Summary | null }) {
  const value = (n: number | undefined) => (n === undefined ? '…' : formatNumber(n));
  const range = summary ? formatDateRange(summary.windowStart, summary.windowEnd) : ' ';
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
      <BudgetKpi
        used={summary?.publicClicksToday}
        budget={summary?.publicDailyBudget}
        publicTotal={summary?.publicTotal}
      />
    </div>
  );
}

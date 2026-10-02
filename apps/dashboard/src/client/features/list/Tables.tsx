import { PUBLIC_DAILY_CLICK_LIMIT, type Link, type LinkListItem, type PublicLinkItem } from '@daffa/shared';
import { Panel, PanelHeader } from '../../components/surfaces';
import { formatNumber } from '../../lib/format';
import { LinkRow } from './LinkRow';
import { LoadMore } from './LoadMore';
import { PublicLinkRow } from './PublicLinkRow';
import styles from './list.module.css';

/** What both tables need from the list to show the Load More footer. */
export interface Paging {
  matching: number;
  total: number;
  hasMore: boolean;
  loadingMore: boolean;
  paused: boolean;
  onLoadMore: () => void;
}

function Footer({ loaded, paging }: { loaded: number; paging: Paging }) {
  if (!paging.hasMore) return null;
  return (
    <LoadMore
      loaded={loaded}
      matching={paging.matching}
      loading={paging.loadingMore}
      paused={paging.paused}
      onLoad={paging.onLoadMore}
    />
  );
}

interface PrivateTableProps {
  links: LinkListItem[];
  paging: Paging;
  onToggled: (link: Link) => void;
  menuOpenFirst: boolean;
}

export function PrivateTable({ links, paging, onToggled, menuOpenFirst }: PrivateTableProps) {
  return (
    <Panel aria-label="Private links">
      <PanelHeader>
        <span>
          {formatNumber(paging.matching)} OF {formatNumber(paging.total)} LINKS
        </span>
        <span>HUMAN CLICKS {'·'} 7 DAYS</span>
      </PanelHeader>
      {links.map((link, index) => (
        <LinkRow key={link.id} link={link} onToggled={onToggled} defaultMenuOpen={index === 0 && menuOpenFirst} />
      ))}
      <Footer loaded={links.length} paging={paging} />
    </Panel>
  );
}

interface PublicTableProps {
  links: PublicLinkItem[];
  paging: Paging;
  /** A tag filter is set. It only narrows private links, which the note says. */
  tagFiltered: boolean;
  onUpdated: (link: PublicLinkItem) => void;
  onBlock: (link: PublicLinkItem) => void;
  onShowBlocked: (host: string) => void;
  onDelete: (link: PublicLinkItem) => void;
  menuOpenFirst: boolean;
}

export function PublicTable({
  links,
  paging,
  tagFiltered,
  onUpdated,
  onBlock,
  onShowBlocked,
  onDelete,
  menuOpenFirst,
}: PublicTableProps) {
  return (
    <Panel aria-label="Public links">
      <PanelHeader>
        <span>
          {formatNumber(paging.matching)} OF {formatNumber(paging.total)} PUBLIC LINKS
        </span>
        <span>
          CLICKS {'·'} DAILY LIMIT {formatNumber(PUBLIC_DAILY_CLICK_LIMIT)}
        </span>
      </PanelHeader>
      {tagFiltered && (
        <div role="note" className={styles.tagNote}>
          The tag filter applies only to private links. Public links have no tags.
        </div>
      )}
      {links.map((link, index) => (
        <PublicLinkRow
          key={link.id}
          link={link}
          onUpdated={onUpdated}
          onBlock={onBlock}
          onShowBlocked={onShowBlocked}
          onDelete={onDelete}
          defaultMenuOpen={index === 0 && menuOpenFirst}
        />
      ))}
      <Footer loaded={links.length} paging={paging} />
    </Panel>
  );
}

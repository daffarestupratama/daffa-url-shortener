import { formatNumber } from '../lib/format';
import { COLO_TOOLTIP, coloCity } from '../lib/colos';
import { FLAG_URLS } from '../lib/flagUrls';
import { lookupFlag } from '../lib/flags';
import { pageWindow } from '../lib/pagination';
import type { RankRow } from '../lib/rankings';
import { GlobeIcon } from './Icons';
import styles from './data.module.css';

const cx = (...names: Array<string | false | null | undefined>) => names.filter(Boolean).join(' ');

/**
 * A country flag. The design used emoji, which Chrome on Windows shows as two
 * letters, so this draws a bundled SVG, a code chip when no flag exists, or
 * nothing when the country is unknown. The country name always sits next to
 * it, so the image itself is decorative.
 */
export function Flag({ code, size = 'large' }: { code: string | null | undefined; size?: 'large' | 'small' }) {
  const flag = lookupFlag(code, FLAG_URLS);
  if (flag.kind === 'none') return null;
  if (flag.kind === 'code') {
    return (
      <span className={styles.flagCode} title={`Country code ${flag.code}`}>
        {flag.code}
      </span>
    );
  }
  return (
    <img
      src={flag.url}
      alt=""
      loading="lazy"
      decoding="async"
      className={cx(styles.flag, size === 'large' ? styles.flagLarge : styles.flagSmall)}
      width={size === 'large' ? 18 : 16}
      height={size === 'large' ? 12 : 11}
    />
  );
}

export function AsnChip({ asn }: { asn: number | null }) {
  return <span className={styles.asn}>{asn === null ? 'AS?' : `AS${asn}`}</span>;
}

export function ColoChip({ code }: { code: string | null }) {
  if (!code) return <span className={styles.colo}>?</span>;
  return (
    <span className={styles.colo} title={COLO_TOOLTIP} aria-label={`${COLO_TOOLTIP}: ${code}`}>
      {code}
    </span>
  );
}

export function DcTile({ code, count }: { code: string | null; count: number }) {
  const city = coloCity(code);
  return (
    <div className={styles.dcTile} title={COLO_TOOLTIP}>
      <span className={styles.dcCode} aria-label={`${COLO_TOOLTIP}: ${code ?? 'unknown'}`}>
        {code ?? '?'}
      </span>
      {city && <span className={styles.dcCity}>{city}</span>}
      <span className={styles.dcCount}>{formatNumber(count)}</span>
    </div>
  );
}

interface RankListProps {
  rows: readonly RankRow[];
  /** Show a flag (or the globe on the Other row) before each label. */
  flags?: boolean;
  tone?: 'ink' | 'bot';
  /** Monospace labels, as the design uses for bot names. */
  mono?: boolean;
  emptyText?: string;
}

export function RankList({ rows, flags, tone = 'ink', mono, emptyText = 'No data in this range.' }: RankListProps) {
  if (rows.length === 0) return <p className={styles.empty}>{emptyText}</p>;
  return (
    <div className={styles.rankList}>
      {rows.map((row) => (
        <div key={row.key} className={styles.rankItem}>
          <div className={styles.rankRow}>
            {flags && (row.other ? <span className={styles.globe}><GlobeIcon /></span> : <Flag code={row.country} />)}
            <span className={styles.rankLabel} style={mono ? { fontFamily: 'var(--mono)', fontWeight: 500 } : undefined} title={row.label}>
              {row.label}
            </span>
            <span className={styles.rankCount}>{row.countText}</span>
            <span className={styles.rankPct}>{row.pct}</span>
          </div>
          <div className={cx(styles.track, tone === 'bot' && styles.trackBot)}>
            <div className={styles.fill} style={{ width: row.width }} />
          </div>
        </div>
      ))}
    </div>
  );
}

/** The thinner bar used under ASN rows. */
export function ThinBar({ width }: { width: string }) {
  return (
    <div className={cx(styles.track, styles.trackThin)}>
      <div className={styles.fill} style={{ width }} />
    </div>
  );
}

interface PaginationProps {
  /** 1 based */
  page: number;
  pages: number;
  onPage: (page: number) => void;
  label: string;
}

/**
 * The design's pagination, compacted for dozens of pages:
 * First, Previous, 1 ... 7 8 9 ... 19, Next, Last. Disabled ends use the
 * native disabled attribute.
 */
export function Pagination({ page, pages, onPage, label }: PaginationProps) {
  if (pages < 2) return null;
  const items = pageWindow(page, pages);
  return (
    <nav aria-label={label} className={styles.pagination}>
      <button type="button" className={styles.pageButton} disabled={page <= 1} onClick={() => onPage(1)}>
        First
      </button>
      <button type="button" className={styles.pageButton} disabled={page <= 1} onClick={() => onPage(page - 1)}>
        Previous
      </button>
      {items.map((item) =>
        item.kind === 'gap' ? (
          <span key={item.key} className={styles.gap} aria-hidden="true">
            {'…'}
          </span>
        ) : (
          <button
            key={item.page}
            type="button"
            className={cx(styles.pageButton, styles.pageNumber)}
            aria-current={item.page === page ? 'page' : undefined}
            aria-label={`Page ${item.page}`}
            onClick={() => onPage(item.page)}
          >
            {item.page}
          </button>
        ),
      )}
      <button type="button" className={styles.pageButton} disabled={page >= pages} onClick={() => onPage(page + 1)}>
        Next
      </button>
      <button type="button" className={styles.pageButton} disabled={page >= pages} onClick={() => onPage(pages)}>
        Last
      </button>
    </nav>
  );
}

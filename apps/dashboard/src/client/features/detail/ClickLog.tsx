import type { Range } from '@daffa/shared';
import { useEffect } from 'react';
import { ColoChip, Flag, Pagination } from '../../components/data';
import { Panel, PanelHeader, Skeleton } from '../../components/surfaces';
import { Badge } from '../../components/tiles';
import { api } from '../../lib/api';
import { countryName } from '../../lib/flags';
import { formatDate, formatNumber, formatTime } from '../../lib/format';
import { pageRange } from '../../lib/pagination';
import { describeBrowser, parseUserAgent } from '../../lib/ua';
import { useResource } from '../../lib/useResource';
import styles from './detail.module.css';

const PAGE_SIZE = 10;

function referrerLabel(referrer: string | null, isBot: boolean): string {
  if (isBot) return '(preview)';
  if (!referrer) return '(direct)';
  try {
    return new URL(referrer).hostname.replace(/^www\./, '') || '(direct)';
  } catch {
    return referrer.slice(0, 60);
  }
}

interface ClickLogProps {
  linkId: number;
  range: Range;
  /** 1 based, from the URL. */
  page: number;
  onPage: (page: number) => void;
  version: number;
}

export function ClickLog({ linkId, range, page, onPage, version }: ClickLogProps) {
  const log = useResource(`clicks:${linkId}:${range}:${page}:${version}`, (signal) =>
    api.clicks(linkId, range, page, signal),
  );

  const total = log.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // A page number past the end, for example after the range shrank, moves to the last page.
  useEffect(() => {
    if (log.data && total > 0 && page > pages) onPage(pages);
  }, [log.data, total, page, pages, onPage]);

  const { from, to } = pageRange(page, PAGE_SIZE, total);

  return (
    <Panel className={styles.log} aria-label="Recent click log">
      <PanelHeader className={styles.logHead}>
        <span>RECENT CLICK LOG</span>
        <span className={styles.logNote}>Times in WIB</span>
      </PanelHeader>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">TIME</th>
              <th scope="col">IP ADDRESS</th>
              <th scope="col">LOCATION</th>
              <th scope="col" title="Cloudflare data center that served the request">
                CF DATA CENTER
              </th>
              <th scope="col">NETWORK</th>
              <th scope="col">DEVICE</th>
              <th scope="col">REFERRER</th>
              <th scope="col">TYPE</th>
            </tr>
          </thead>
          <tbody aria-busy={log.loading}>
            {log.initial &&
              [1, 2, 3, 4, 5].map((n) => (
                <tr key={n}>
                  {[70, 110, 110, 50, 200, 150, 100, 60].map((width, i) => (
                    <td key={i}>
                      <Skeleton width={width} height={14} tone={i % 2 ? 2 : 1} />
                    </td>
                  ))}
                </tr>
              ))}
            {(log.data?.rows ?? []).map((row) => {
              const parsed = parseUserAgent(row.ua, row.isBot);
              return (
                <tr key={row.id} className={row.isBot ? styles.botRow : undefined}>
                  <td className={`${styles.nowrap} ${styles.num}`}>
                    <span className={styles.strong}>{formatTime(row.ts)}</span>
                    <br />
                    <span className={styles.sub}>{formatDate(row.ts)}</span>
                  </td>
                  <td className={`${styles.monoCell} ${styles.nowrap}`}>{row.ip}</td>
                  <td className={styles.nowrap}>
                    <span className={styles.location}>
                      <Flag code={row.country} size="small" />
                      {row.city ?? countryName(row.country)}
                    </span>
                  </td>
                  <td>
                    <ColoChip code={row.colo} />
                  </td>
                  <td>
                    <span className={styles.asnInline}>{row.asn === null ? 'AS?' : `AS${row.asn}`}</span>
                    {row.asOrg ?? 'Unknown network'}
                  </td>
                  <td>
                    {parsed.device}
                    <br />
                    <span className={styles.sub}>{describeBrowser(parsed)}</span>
                  </td>
                  <td className={styles.monoCell}>{referrerLabel(row.referrer, row.isBot)}</td>
                  <td className={styles.nowrap}>
                    {row.isBot ? (
                      <Badge tone="bot" size="xs">
                        BOT
                      </Badge>
                    ) : (
                      <span className={styles.human}>Human</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className={styles.logFoot}>
        <span className={styles.caption}>
          {total > 0
            ? `Showing ${formatNumber(from)} to ${formatNumber(to)} of ${formatNumber(total)} recent clicks`
            : log.initial
              ? ' '
              : 'No clicks yet'}
        </span>
        <Pagination page={Math.min(page, pages)} pages={pages} onPage={onPage} label="Click log pages" />
      </div>
    </Panel>
  );
}

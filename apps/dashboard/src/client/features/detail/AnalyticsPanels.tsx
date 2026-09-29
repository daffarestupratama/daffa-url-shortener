import type { Analytics } from '@daffa/shared';
import { AsnChip, DcTile, RankList, ThinBar } from '../../components/data';
import { Panel, PanelTitle } from '../../components/surfaces';
import { Badge, Kicker } from '../../components/tiles';
import { countryName } from '../../lib/flags';
import { formatNumber } from '../../lib/format';
import { withOther, type RankInput } from '../../lib/rankings';
import { aggregateUserAgents, type UaDimension } from '../../lib/ua';
import styles from './detail.module.css';

function fromUserAgents(analytics: Analytics, dimension: UaDimension): RankInput[] {
  return aggregateUserAgents(analytics.userAgents.human, dimension, false).map((row) => ({
    key: row.label,
    label: row.label,
    count: row.count,
  }));
}

/** COUNTRY, CITY, DEVICE, BROWSER, OPERATING SYSTEM, REFERRER. Human clicks only, as in the design. */
export function RankingsGrid({ analytics }: { analytics: Analytics }) {
  const total = analytics.totals.human;

  const panels: Array<{ title: string; rows: RankInput[]; flags?: boolean }> = [
    {
      title: 'COUNTRY',
      flags: true,
      rows: analytics.countries.map((row) => ({
        key: row.country ?? 'unknown',
        label: countryName(row.country),
        count: row.count,
        country: row.country,
      })),
    },
    {
      title: 'CITY',
      rows: analytics.cities.map((row) => ({
        key: `${row.city ?? 'unknown'}|${row.country ?? ''}`,
        label: row.city ?? 'Unknown',
        count: row.count,
      })),
    },
    { title: 'DEVICE', rows: fromUserAgents(analytics, 'device') },
    { title: 'BROWSER', rows: fromUserAgents(analytics, 'browser') },
    { title: 'OPERATING SYSTEM', rows: fromUserAgents(analytics, 'os') },
    {
      title: 'REFERRER',
      rows: analytics.referrers.map((row) => ({
        key: row.host ?? 'direct',
        label: row.host ?? 'Direct (no referrer)',
        count: row.count,
      })),
    },
  ];

  return (
    <div className={styles.rankGrid}>
      {panels.map((panel) => (
        <Panel key={panel.title} className={styles.rankPanel} aria-label={panel.title.toLowerCase()}>
          <PanelTitle>{panel.title}</PanelTitle>
          <RankList rows={withOther(panel.rows, total)} flags={panel.flags} />
        </Panel>
      ))}
    </div>
  );
}

/**
 * Cloudflare data centers and network organizations. Colo codes describe the
 * Cloudflare location that served the redirect, not where the visitor is, so
 * the heading matches the CF DATA CENTER column in the click log.
 */
export function NetworkPanel({ analytics }: { analytics: Analytics }) {
  const topAsn = Math.max(1, ...analytics.asns.map((row) => row.count));
  return (
    <Panel className={styles.network} aria-label="Network">
      <Kicker>NETWORK</Kicker>
      <div className={styles.subHead}>
        <span className={styles.subTitle}>CF data centers</span>
        <span className={styles.subText}>
          Cloudflare data centers that served the redirect. Codes follow IATA airport codes.
        </span>
      </div>
      {analytics.colos.length === 0 ? (
        <span className={styles.subText}>No data in this range.</span>
      ) : (
        <div className={styles.dcGrid}>
          {analytics.colos.map((row) => (
            <DcTile key={row.colo ?? 'unknown'} code={row.colo} count={row.count} />
          ))}
        </div>
      )}
      <div className={`${styles.subHead} ${styles.asnSection}`}>
        <span className={styles.subTitle}>Network organizations (ASN)</span>
      </div>
      <div className={styles.asnList}>
        {analytics.asns.slice(0, 7).map((row) => (
          <div key={`${row.asn}|${row.org}`} className={styles.asnItem}>
            <div className={styles.asnRow}>
              <AsnChip asn={row.asn} />
              <span className={styles.asnOrg} title={row.org ?? undefined}>
                {row.org ?? 'Unknown network'}
              </span>
              <span className={styles.asnCount}>{formatNumber(row.count)}</span>
            </div>
            <ThinBar width={`${(row.count / topAsn) * 100}%`} />
          </div>
        ))}
      </div>
    </Panel>
  );
}

export function BotPanel({ analytics, slug }: { analytics: Analytics; slug: string }) {
  const rows = aggregateUserAgents(analytics.userAgents.bot, 'bot', true).map((row) => ({
    key: row.label,
    label: row.label,
    count: row.count,
  }));
  return (
    <Panel className={styles.bots} aria-label="Bot clicks">
      <div className={styles.botsHead}>
        <Badge tone="bot" size="md" wide>
          BOT CLICKS
        </Badge>
        <span className={styles.botsCount}>{formatNumber(analytics.totals.bot)}</span>
      </div>
      <p className={styles.botsText}>
        These clicks come from services that fetch a link preview when daffa.me/{slug} is shared in messaging apps or
        on social media. Bot clicks are not counted as human clicks or unique visitors.
      </p>
      <RankList rows={withOther(rows, analytics.totals.bot)} tone="bot" mono emptyText="No bot clicks in this range." />
    </Panel>
  );
}

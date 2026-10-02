import { RANGES, RANGE_TEXT, type Analytics, type Link as LinkModel, type Range } from '@daffa/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, SegmentedControl, buttonClass } from '../../components/controls';
import { KpiCard, Panel, Skeleton } from '../../components/surfaces';
import { Badge, GateTile, Kicker, StatusBadge, Tag } from '../../components/tiles';
import { api, ApiError } from '../../lib/api';
import { copyShortLink } from '../../lib/clipboard';
import { formatDateTime, formatNumber, formatPercent, formatRelative } from '../../lib/format';
import { applyDetailOverlay, detailFlags } from '../../lib/preview';
import { DASHBOARD_BASE, Link } from '../../lib/router';
import { pickEnum, pickPositiveInt, useSearchParams } from '../../lib/useQuery';
import { useResource } from '../../lib/useResource';
import { useApp } from '../app/AppProvider';
import { listPathWithFilters } from '../list/LinksPage';
import { BotPanel, NetworkPanel, RankingsGrid } from './AnalyticsPanels';
import { ClickLog } from './ClickLog';
import { ClicksChart } from './ClicksChart';
import { DetailSkeleton } from './DetailSkeleton';
import styles from './detail.module.css';

const cx = (...names: Array<string | false | null | undefined>) => names.filter(Boolean).join(' ');

const RANGE_KEYS = RANGES.map(([key]) => key);

function BackLink() {
  return (
    <Link to={listPathWithFilters()} className={buttonClass('secondary', 'sm', styles.back)}>
      {'←'} All Links
    </Link>
  );
}

/** Default export so App can load this page, and everything only it uses, lazily. */
export default function LinkDetailPage({ rawId }: { rawId: string }) {
  const app = useApp();
  const { params, search, update } = useSearchParams();
  const flags = detailFlags(search);
  const id = /^[1-9][0-9]{0,15}$/.test(rawId) ? Number(rawId) : null;

  const range = pickEnum(params.get('range'), RANGE_KEYS, '30d');
  const page = pickPositiveInt(params.get('page'), 1);

  const detail = useResource(id === null ? null : `detail:${id}:${app.version}`, (signal) => api.link(id!, signal));
  const analytics = useResource(id === null ? null : `analytics:${id}:${range}:${app.version}`, (signal) =>
    api.analytics(id!, range, signal),
  );

  const setRange = (value: Range) =>
    update({ range: { value, fallback: '30d' }, page: { value: '1', fallback: '1' } });
  const setPage = useCallback((value: number) => update({ page: { value: String(value), fallback: '1' } }), [update]);

  const link = detail.data?.link ?? null;

  // Dev only: open an overlay from the URL once the link has loaded.
  // In production applyDetailOverlay is a constant that returns true.
  const previewDone = useRef(false);
  useEffect(() => {
    if (!previewDone.current) previewDone.current = applyDetailOverlay(search, app, link);
  }, [search, link, app]);

  const forced = flags.loading || flags.error || flags.notFound;
  const notFound =
    flags.notFound || id === null || (!forced && detail.error instanceof ApiError && detail.error.code === 'not_found');
  const loading = !notFound && (flags.loading || (!forced && detail.initial));
  const failed = !notFound && !loading && (flags.error || (!forced && detail.error !== null && !link));

  if (notFound) return <NotFoundView />;
  if (loading) return <DetailSkeleton />;
  if (failed || !link) return <DetailError onReload={detail.reload} />;

  return (
    <>
      <BackLink />
      <DetailHeader link={link} />

      <div className={styles.analyticsHead}>
        <Kicker>ANALYTICS</Kicker>
        <SegmentedControl label="Time range" options={RANGES} value={range} onChange={setRange} />
      </div>

      <AnalyticsSection
        link={link}
        range={range}
        page={page}
        onPage={setPage}
        analytics={analytics.data}
        forceEmpty={flags.empty}
        forceFlat={flags.flat}
      />
    </>
  );
}

function DetailHeader({ link }: { link: LinkModel }) {
  const { openQr, openEdit, toast } = useApp();
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const copy = async () => {
    await copyShortLink(link.slug, toast);
    setCopied(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(false), 1600);
  };

  return (
    <Panel className={styles.header} aria-label="Link">
      <div className={styles.headRow}>
        <GateTile slug={link.slug} variant="detail" prefix="domain" />
        <div className={styles.headButtons}>
          <Button size="md" onClick={copy}>
            {copied ? 'Copied' : 'Copy'}
          </Button>
          <Button size="md" onClick={() => openQr({ id: link.id, slug: link.slug, title: link.title })}>
            QR Code
          </Button>
          <Button size="md" onClick={() => openEdit(link)}>
            Edit
          </Button>
        </div>
        <StatusBadge status={link.status} size="lg" className={styles.headBadge} />
      </div>
      <a href={link.url} target="_blank" rel="noopener noreferrer" className={styles.dest}>
        {link.url.replace(/^https?:\/\//, '').replace(/^www\./, '')}
      </a>
      <div className={styles.titleBlock}>
        <h1 className={styles.h1}>{link.title}</h1>
        <p className={styles.desc}>{link.description || 'No description.'}</p>
      </div>
      <div className={styles.meta}>
        {link.tags.length > 0 && (
          <div className={styles.metaTags}>
            {link.tags.map((tag) => (
              <Tag key={tag} name={tag} size="medium" />
            ))}
          </div>
        )}
        <span className={styles.metaItem}>
          <span className={styles.metaLabel}>CREATED</span>
          {formatDateTime(link.createdAt)}
        </span>
        <span className={styles.metaItem}>
          <span className={styles.metaLabel}>EXPIRES</span>
          {link.expiresAt === null ? 'None' : formatDateTime(link.expiresAt)}
        </span>
      </div>
    </Panel>
  );
}

interface AnalyticsSectionProps {
  link: LinkModel;
  range: Range;
  page: number;
  onPage: (page: number) => void;
  analytics: Analytics | null;
  forceEmpty: boolean;
  forceFlat: boolean;
}

function AnalyticsSection({ link, range, page, onPage, analytics, forceEmpty, forceFlat }: AnalyticsSectionProps) {
  const { openQr, toast, version } = useApp();
  const pending = '…';
  const human = analytics?.totals.human;
  const unique = analytics?.totals.unique;
  const lastAt = forceEmpty ? null : (analytics?.allTime.lastHumanAt ?? null);
  const empty = forceEmpty || (analytics !== null && analytics.allTime.human === 0);

  return (
    <>
      <div className={styles.kpis}>
        <KpiCard
          label="HUMAN CLICKS"
          legend="ink"
          value={forceEmpty ? '0' : human === undefined ? pending : formatNumber(human)}
          foot={RANGE_TEXT[range]}
        />
        <KpiCard
          label="UNIQUE VISITORS"
          legend="link"
          tone="link"
          value={forceEmpty ? '0' : unique === undefined ? pending : formatNumber(unique)}
          foot={
            !forceEmpty && human !== undefined && human > 0 && unique !== undefined
              ? `${formatPercent(unique, human)} of human clicks`
              : 'no visitors yet'
          }
        />
        <KpiCard
          label="BOT CLICKS"
          legend="bot"
          tone="bot"
          value={forceEmpty ? '0' : analytics ? formatNumber(analytics.totals.bot) : pending}
          foot="not counted as visitors"
        />
        <KpiCard
          label="LAST CLICK"
          value={lastAt === null ? (analytics || forceEmpty ? 'Never' : pending) : formatRelative(lastAt, Date.now())}
          valueClassName={styles.lastClick}
          foot={lastAt === null ? 'The link has never been opened' : formatDateTime(lastAt)}
        />
      </div>

      {empty ? (
        <Panel className={styles.statePanel}>
          <Badge tone="off" size="md" wide>
            NO ARRIVALS YET
          </Badge>
          <h2 className={styles.h2}>This link has not been clicked yet</h2>
          <p className={cx(styles.stateText, styles.stateTextUrl)}>
            Charts, location rankings, network data, and the click log will appear after daffa.me/{link.slug} is
            opened for the first time.
          </p>
          <div className={styles.stateButtons}>
            <Button variant="primary" onClick={() => copyShortLink(link.slug, toast)}>
              Copy Link
            </Button>
            <Button onClick={() => openQr({ id: link.id, slug: link.slug, title: link.title })}>Show QR Code</Button>
          </div>
        </Panel>
      ) : analytics ? (
        <>
          <ClicksChart analytics={analytics} forceFlat={forceFlat} />
          <RankingsGrid analytics={analytics} />
          <div className={styles.pair}>
            <NetworkPanel analytics={analytics} />
            <BotPanel analytics={analytics} slug={link.slug} />
          </div>
          <ClickLog linkId={link.id} range={range} page={page} onPage={onPage} version={version} />
        </>
      ) : (
        <Panel className={styles.chartPanel} aria-busy="true" aria-label="Loading analytics">
          <Skeleton width="30%" height={12} />
          <Skeleton width="100%" height={260} radius={8} tone={2} />
        </Panel>
      )}
    </>
  );
}

function DetailError({ onReload }: { onReload: () => void }) {
  return (
    <>
      <BackLink />
      <Panel role="alert" className={cx(styles.statePanel, styles.stateStart)}>
        <Badge tone="danger" size="md">
          ERROR {'·'} 503
        </Badge>
        <h2 className={styles.h2}>Link failed to load</h2>
        <p className={styles.stateText}>
          The server did not respond within 10 seconds. Short links keep working for visitors. Check your internet
          connection, then reload the page.
        </p>
        <Button size="md" onClick={onReload}>
          Reload
        </Button>
      </Panel>
    </>
  );
}

function NotFoundView() {
  return (
    <>
      <BackLink />
      <Panel className={styles.statePanel}>
        <GateTile slug="_ _ _" variant="empty" />
        <h2 className={styles.h2}>Link not found</h2>
        <p className={styles.stateText}>No link exists at this address. It may have been deleted.</p>
        <Link to={DASHBOARD_BASE} className={buttonClass('primary', 'lg')}>
          Go to All Links
        </Link>
      </Panel>
    </>
  );
}

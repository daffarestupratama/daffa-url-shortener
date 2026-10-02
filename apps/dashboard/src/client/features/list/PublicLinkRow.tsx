import { PUBLIC_DAILY_CLICK_LIMIT, type PublicLinkItem } from '@daffa/shared';
import { useState } from 'react';
import { IconButton } from '../../components/controls';
import { QrIcon } from '../../components/Icons';
import { Badge, GateTile, StatusBadge } from '../../components/tiles';
import { api, ApiError } from '../../lib/api';
import { formatDate, formatNumber, formatTime } from '../../lib/format';
import { useApp } from '../app/AppProvider';
import { CopySlugButton } from './CopySlugButton';
import { RowMenu } from './RowMenu';
import styles from './list.module.css';

const cx = (...names: Array<string | false | null | undefined>) => names.filter(Boolean).join(' ');

interface PublicLinkRowProps {
  link: PublicLinkItem;
  /** The link after enabling or disabling, as the API returned it. */
  onUpdated: (link: PublicLinkItem) => void;
  onBlock: (link: PublicLinkItem) => void;
  /** Opens the Blocked Domains list, searched for this host. */
  onShowBlocked: (host: string) => void;
  onDelete: (link: PublicLinkItem) => void;
  defaultMenuOpen?: boolean;
}

/**
 * A link created on the public page. Counters only, no analytics and no edit:
 * the owner can copy it, show its QR code, enable or disable it, block its
 * domain, or delete it.
 */
export function PublicLinkRow({ link, onUpdated, onBlock, onShowBlocked, onDelete, defaultMenuOpen = false }: PublicLinkRowProps) {
  const { openQr, toast } = useApp();
  const [busy, setBusy] = useState(false);
  const limited = link.isActive && link.limitReached;
  const todayWidth = Math.min(100, (link.clicksToday / PUBLIC_DAILY_CLICK_LIMIT) * 100);

  const toggle = async () => {
    setBusy(true);
    try {
      const { link: updated } = await api.setPublicActive(link.id, !link.isActive);
      toast(updated.isActive ? `daffa.me/${link.slug} enabled` : `daffa.me/${link.slug} disabled. The slug stays reserved`);
      onUpdated(updated);
    } catch (error) {
      toast(error instanceof ApiError ? error.message : 'The link status could not be changed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.row}>
      <div className={styles.pubSlugCell}>
        {limited ? <Badge tone="exp">DAILY LIMIT</Badge> : <StatusBadge status={link.status} />}
        <div className={styles.slugLine}>
          <GateTile slug={link.slug} variant="row" className={styles.pubTile} />
          <CopySlugButton slug={link.slug} />
        </div>
      </div>

      <div className={styles.pubInfo}>
        <span className={styles.pubHost}>{link.host}</span>
        <a href={link.url} target="_blank" rel="noopener nofollow noreferrer" className={styles.pubUrl} title={link.url}>
          {link.url.replace(/^https?:\/\//, '')}
        </a>
      </div>

      <div className={styles.created}>
        <span className={styles.createdLabel}>CREATED</span>
        <span className={styles.createdDate}>{formatDate(link.createdAt)}</span>
        <span className={styles.createdTime}>{formatTime(link.createdAt)} WIB</span>
      </div>

      <div className={styles.pubClicks}>
        <span className={styles.pubTotal}>
          <span className={styles.pubTotalValue}>{formatNumber(link.clickTotal)}</span>
          <span className={styles.pubTotalLabel}>total</span>
        </span>
        <div className={styles.meter}>
          <div className={cx(styles.meterFill, limited && styles.meterLimit)} style={{ width: `${todayWidth}%` }} />
        </div>
        <span className={styles.today}>
          Today <strong>{formatNumber(link.clicksToday)}</strong> / {formatNumber(PUBLIC_DAILY_CLICK_LIMIT)}
        </span>
      </div>

      <div className={styles.actions}>
        <IconButton label="Show QR code" onClick={() => openQr({ id: link.id, slug: link.slug, title: link.host })}>
          <QrIcon />
        </IconButton>
        <RowMenu
          label={`Actions for daffa.me/${link.slug}`}
          defaultOpen={defaultMenuOpen}
          items={[
            { label: link.isActive ? 'Disable link' : 'Enable link', onSelect: toggle, disabled: busy },
            link.domainBlocked
              ? { label: 'Domain already blocked', tone: 'muted', onSelect: () => onShowBlocked(link.host) }
              : { label: 'Block domain', tone: 'danger', onSelect: () => onBlock(link) },
            'divider',
            { label: 'Delete link', tone: 'danger', onSelect: () => onDelete(link) },
          ]}
        />
      </div>
    </div>
  );
}

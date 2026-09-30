import { hostPath, type LinkListItem } from '@daffa/shared';
import { useEffect, useRef, useState } from 'react';
import { IconButton } from '../../components/controls';
import { ChartIcon, CheckIcon, CopyIcon, EditIcon, KebabIcon, QrIcon } from '../../components/Icons';
import { GateTile, StatusBadge, Tag } from '../../components/tiles';
import { api, ApiError } from '../../lib/api';
import { useDismiss, useEscapeLayer } from '../../lib/focus';
import { formatDate, formatNumber } from '../../lib/format';
import { Link, navigate } from '../../lib/router';
import { useApp } from '../app/AppProvider';
import { copyShortLink } from './copy';
import styles from './list.module.css';

const cx = (...names: Array<string | false | null | undefined>) => names.filter(Boolean).join(' ');

export function expiryText(link: Pick<LinkListItem, 'status' | 'expiresAt'>): string {
  if (link.status === 'expired' && link.expiresAt !== null) return `Ended ${formatDate(link.expiresAt)}`;
  if (link.expiresAt !== null) return `Valid until ${formatDate(link.expiresAt)}`;
  return 'No expiration';
}

interface LinkRowProps {
  link: LinkListItem;
  defaultMenuOpen?: boolean;
}

export function LinkRow({ link, defaultMenuOpen = false }: LinkRowProps) {
  const { openQr, openEdit, openDelete, refresh, toast } = useApp();
  const [copied, setCopied] = useState(false);
  const [menuOpen, setMenuOpen] = useState(defaultMenuOpen);
  const [toggling, setToggling] = useState(false);
  const actions = useRef<HTMLDivElement>(null);
  const copiedTimer = useRef<number | undefined>(undefined);

  const closeMenu = () => setMenuOpen(false);
  useDismiss(actions, menuOpen, closeMenu);
  useEscapeLayer(menuOpen, closeMenu);
  useEffect(() => () => window.clearTimeout(copiedTimer.current), []);

  const detailPath = `/links/${link.id}`;
  const ref = { id: link.id, slug: link.slug, title: link.title };

  const copy = async () => {
    await copyShortLink(link.slug, toast);
    setCopied(true);
    window.clearTimeout(copiedTimer.current);
    copiedTimer.current = window.setTimeout(() => setCopied(false), 1600);
  };

  const toggle = async () => {
    setToggling(true);
    try {
      const { link: updated } = await api.toggleLink(link.id);
      toast(`daffa.me/${link.slug} ${updated.status === 'active' ? 'activated' : 'deactivated'}`);
      refresh();
    } catch (error) {
      toast(error instanceof ApiError ? error.message : 'The link status could not be changed.');
    } finally {
      setToggling(false);
      closeMenu();
    }
  };

  return (
    <div className={styles.row}>
      <div className={styles.slugCell}>
        <StatusBadge status={link.status} />
        <div className={styles.slugLine}>
          <GateTile slug={link.slug} variant="row" />
          <IconButton size={36} label={copied ? `Copied daffa.me/${link.slug}` : `Copy daffa.me/${link.slug}`} onClick={copy}>
            {copied ? <CheckIcon /> : <CopyIcon />}
          </IconButton>
        </div>
        <span className={styles.expiry}>{expiryText(link)}</span>
      </div>

      <div className={styles.info}>
        <Link to={detailPath} className={styles.title}>
          {link.title}
        </Link>
        <a href={link.url} target="_blank" rel="noopener noreferrer" className={styles.dest} title={link.url}>
          {hostPath(link.url)}
        </a>
        {link.tags.length > 0 && (
          <div className={styles.tags}>
            {link.tags.map((tag) => (
              <Tag key={tag} name={tag} />
            ))}
          </div>
        )}
      </div>

      <div className={styles.clicks}>
        <span className={styles.clicksValue}>{formatNumber(link.clicks7d)}</span>
        <span className={styles.clicksLabel}>clicks</span>
      </div>

      <div className={styles.actions} ref={actions}>
        <IconButton label="Show QR code" onClick={() => openQr(ref)}>
          <QrIcon />
        </IconButton>
        <IconButton label="Edit link" onClick={() => openEdit(link)}>
          <EditIcon />
        </IconButton>
        <IconButton label="View analytics" onClick={() => navigate(detailPath)}>
          <ChartIcon />
        </IconButton>
        <IconButton label="More actions" aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen((o) => !o)}>
          <KebabIcon />
        </IconButton>
        {menuOpen && (
          <div role="menu" aria-label={`Actions for daffa.me/${link.slug}`} className={styles.menu}>
            <button type="button" role="menuitem" className={styles.menuItem} onClick={toggle} disabled={toggling}>
              {link.status === 'active' ? 'Deactivate link' : 'Reactivate'}
            </button>
            <div className={styles.menuDivider} role="separator" />
            <button
              type="button"
              role="menuitem"
              className={cx(styles.menuItem, styles.menuDanger)}
              onClick={() => {
                closeMenu();
                openDelete(ref);
              }}
            >
              Delete link
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

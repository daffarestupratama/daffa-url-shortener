import { hostPath, type Link as LinkModel, type LinkListItem } from '@daffa/shared';
import { useState } from 'react';
import { IconButton } from '../../components/controls';
import { ChartIcon, EditIcon, QrIcon } from '../../components/Icons';
import { GateTile, StatusBadge, Tag } from '../../components/tiles';
import { api, ApiError } from '../../lib/api';
import { formatDate, formatNumber } from '../../lib/format';
import { Link, detailPath, navigate } from '../../lib/router';
import { useApp } from '../app/AppProvider';
import { CopySlugButton } from './CopySlugButton';
import { RowMenu } from './RowMenu';
import styles from './list.module.css';

export function expiryText(link: Pick<LinkListItem, 'status' | 'expiresAt'>): string {
  if (link.status === 'expired' && link.expiresAt !== null) return `Ended ${formatDate(link.expiresAt)}`;
  if (link.expiresAt !== null) return `Valid until ${formatDate(link.expiresAt)}`;
  return 'No expiration';
}

interface LinkRowProps {
  link: LinkListItem;
  /** The toggled link as the API returned it, so the list can update the row in place. */
  onToggled: (link: LinkModel) => void;
  defaultMenuOpen?: boolean;
}

export function LinkRow({ link, onToggled, defaultMenuOpen = false }: LinkRowProps) {
  const { openQr, openEdit, openDelete, toast } = useApp();
  const [toggling, setToggling] = useState(false);

  const path = detailPath(link.id);
  const ref = { id: link.id, slug: link.slug, title: link.title };

  const toggle = async () => {
    setToggling(true);
    try {
      const { link: updated } = await api.toggleLink(link.id);
      toast(`daffa.me/${link.slug} ${updated.status === 'active' ? 'activated' : 'deactivated'}`);
      onToggled(updated);
    } catch (error) {
      toast(error instanceof ApiError ? error.message : 'The link status could not be changed.');
    } finally {
      setToggling(false);
    }
  };

  return (
    <div className={styles.row}>
      <div className={styles.slugCell}>
        <StatusBadge status={link.status} />
        <div className={styles.slugLine}>
          <GateTile slug={link.slug} variant="row" />
          <CopySlugButton slug={link.slug} />
        </div>
        <span className={styles.expiry}>{expiryText(link)}</span>
      </div>

      <div className={styles.info}>
        <Link to={path} className={styles.title}>
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

      <div className={styles.actions}>
        <IconButton label="Show QR code" onClick={() => openQr(ref)}>
          <QrIcon />
        </IconButton>
        <IconButton label="Edit link" onClick={() => openEdit(link)}>
          <EditIcon />
        </IconButton>
        <IconButton label="View analytics" onClick={() => navigate(path)}>
          <ChartIcon />
        </IconButton>
        <RowMenu
          label={`Actions for daffa.me/${link.slug}`}
          defaultOpen={defaultMenuOpen}
          items={[
            {
              label: link.status === 'active' ? 'Deactivate link' : 'Reactivate',
              onSelect: toggle,
              disabled: toggling,
            },
            'divider',
            { label: 'Delete link', tone: 'danger', onSelect: () => openDelete(ref) },
          ]}
        />
      </div>
    </div>
  );
}

import type { PublicLinkItem } from '@daffa/shared';
import { useState } from 'react';
import { Button } from '../../components/controls';
import { Dialog } from '../../components/overlay';
import { Badge } from '../../components/tiles';
import { api, ApiError } from '../../lib/api';
import { formatNumber } from '../../lib/format';
import { useApp } from '../app/AppProvider';
import overlays from '../overlays/overlays.module.css';
import styles from './moderation.module.css';

interface PublicDeleteDialogProps {
  link: PublicLinkItem;
  onClose: () => void;
  onDeleted: (id: number) => void;
  onDisabled: (link: PublicLinkItem) => void;
  /** Dev preview only: render without calling the API. */
  preview?: boolean;
}

/**
 * Deleting a public link frees its slug, disabling keeps it reserved. The
 * dialog says so and offers Disable Instead while the link is active.
 */
export function PublicDeleteDialog({ link, onClose, onDeleted, onDisabled, preview = false }: PublicDeleteDialogProps) {
  const { toast } = useApp();
  const [busy, setBusy] = useState<'delete' | 'disable' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const remove = async () => {
    if (preview) return onClose();
    setBusy('delete');
    setError(null);
    try {
      await api.deletePublicLink(link.id);
      toast(`daffa.me/${link.slug} deleted. The slug is available again`);
      onDeleted(link.id);
    } catch (caught) {
      setBusy(null);
      setError(caught instanceof ApiError ? caught.message : 'The link could not be deleted.');
    }
  };

  const disable = async () => {
    if (preview) return onClose();
    setBusy('disable');
    setError(null);
    try {
      const { link: updated } = await api.setPublicActive(link.id, false);
      toast(`daffa.me/${link.slug} disabled. The slug stays reserved`);
      onDisabled(updated);
    } catch (caught) {
      setBusy(null);
      setError(caught instanceof ApiError ? caught.message : 'The link could not be disabled.');
    }
  };

  return (
    <Dialog
      kind="alert"
      level={70}
      labelledBy="pdel-title"
      describedBy="pdel-desc"
      onClose={onClose}
      className={styles.pubDeleteDialog}
    >
      <Badge tone="danger" size="sm" wide className={overlays.badgeStart}>
        PERMANENT DELETE
      </Badge>
      <h2 id="pdel-title" className={overlays.deleteTitle}>
        Delete public link daffa.me/{link.slug}?
      </h2>
      <p id="pdel-desc" className={overlays.deleteText}>
        The link and its {formatNumber(link.clickTotal)} recorded clicks will be deleted. The slug{' '}
        <strong className={styles.mono}>{link.slug}</strong> becomes available again and may be assigned to a new
        public link. Visitors who open this address will see the link not found page.
      </p>
      <div className={styles.compare}>
        <div className={styles.compareItem}>
          <span className={`${styles.compareHead} ${styles.compareDelete}`}>DELETE</span>
          <span className={styles.compareText}>Slug is released for reuse.</span>
        </div>
        <div className={styles.compareItem}>
          <span className={`${styles.compareHead} ${styles.compareDisable}`}>DISABLE</span>
          <span className={styles.compareText}>Slug stays reserved and can be enabled again.</span>
        </div>
      </div>
      {error && (
        <p role="alert" className={overlays.error}>
          {error}
        </p>
      )}
      <div className={overlays.deleteActions}>
        <Button variant="secondary" onClick={onClose} data-autofocus>
          Cancel
        </Button>
        {link.isActive && (
          <Button variant="secondary" onClick={disable} disabled={busy !== null} aria-busy={busy === 'disable'}>
            {busy === 'disable' ? 'Disabling' : 'Disable Instead'}
          </Button>
        )}
        <Button variant="danger" onClick={remove} disabled={busy !== null} aria-busy={busy === 'delete'}>
          {busy === 'delete' ? 'Deleting' : 'Delete Permanently'}
        </Button>
      </div>
    </Dialog>
  );
}

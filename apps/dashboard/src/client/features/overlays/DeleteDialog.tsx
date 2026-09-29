import { useEffect, useState } from 'react';
import { Button } from '../../components/controls';
import { Dialog } from '../../components/overlay';
import { Badge } from '../../components/tiles';
import { api, ApiError } from '../../lib/api';
import { formatNumber } from '../../lib/format';
import { matchDetail, navigate } from '../../lib/router';
import { useApp, type LinkRef } from '../app/AppProvider';
import styles from './overlays.module.css';

interface DeleteDialogProps {
  link: LinkRef;
  onClose: () => void;
  onDeleted: () => void;
}

export function DeleteDialog({ link, onClose, onDeleted }: DeleteDialogProps) {
  const { refresh, toast } = useApp();
  const [totals, setTotals] = useState<{ human: number; bot: number } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The list does not carry all time totals, so the confirmation fetches them.
  useEffect(() => {
    const controller = new AbortController();
    api.link(link.id, controller.signal).then(
      (detail) => setTotals(detail.totals),
      () => undefined,
    );
    return () => controller.abort();
  }, [link.id]);

  const confirm = async () => {
    setDeleting(true);
    setError(null);
    try {
      await api.deleteLink(link.id);
      toast(`Link daffa.me/${link.slug} deleted`);
      onDeleted();
      refresh();
      if (matchDetail(window.location.pathname) === String(link.id)) navigate('/', { replace: true });
    } catch (caught) {
      setDeleting(false);
      setError(caught instanceof ApiError ? caught.message : 'The link could not be deleted.');
    }
  };

  const count = (value: number | undefined) => (value === undefined ? '…' : formatNumber(value));

  return (
    <Dialog layer="delete" labelledBy="del-title" describedBy="del-desc" onClose={onClose} className={styles.deleteDialog}>
      <Badge tone="danger" size="sm" wide className={styles.badgeStart}>
        PERMANENT DELETE
      </Badge>
      <h2 id="del-title" className={styles.deleteTitle}>
        Delete link daffa.me/{link.slug}?
      </h2>
      <p id="del-desc" className={styles.deleteText}>
        The link and all of its click data will be deleted, including {count(totals?.human)} human clicks and{' '}
        {count(totals?.bot)} bot clicks. Visitors who open this address will see the link not found page. This action
        cannot be undone.
      </p>
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      <div className={styles.deleteActions}>
        <Button variant="secondary" onClick={onClose} data-autofocus>
          Cancel
        </Button>
        <Button variant="danger" onClick={confirm} disabled={deleting} aria-busy={deleting}>
          {deleting ? 'Deleting' : 'Delete Permanently'}
        </Button>
      </div>
    </Dialog>
  );
}

import type { BlockDomainResult, BlockedDomainCheck } from '@daffa/shared';
import { useEffect, useRef, useState } from 'react';
import { Button } from '../../components/controls';
import { CheckIcon } from '../../components/Icons';
import { Dialog } from '../../components/overlay';
import { Badge } from '../../components/tiles';
import { api, ApiError, isAbort } from '../../lib/api';
import { formatNumber } from '../../lib/format';
import { useApp } from '../app/AppProvider';
import overlays from '../overlays/overlays.module.css';
import styles from './moderation.module.css';

interface BlockDomainDialogProps {
  /** The host to block, from a row or typed into the Blocked Domains modal. */
  host: string;
  onClose: () => void;
  /** After the domain was added. `disableActive` says whether existing links were switched off too. */
  onBlocked: (result: BlockDomainResult, disableActive: boolean) => void;
  /**
   * The check rejected the host as not a domain name. Set when the host was
   * typed, so the message can show under the field instead of in the dialog.
   */
  onInvalidHost?: (message: string) => void;
  /** Dev preview only: this check result instead of a request. */
  forced?: BlockedDomainCheck;
  /** Dev preview only: confirming closes the dialog without blocking anything. */
  preview?: boolean;
}

/**
 * Confirms a block. It first asks the check endpoint whether the host is
 * already covered and how many active public links point to it, then offers
 * to disable those links as well. Disabled links keep their slugs.
 */
export function BlockDomainDialog({ host, onClose, onBlocked, onInvalidHost, forced, preview = false }: BlockDomainDialogProps) {
  const { toast } = useApp();
  const [check, setCheck] = useState<BlockedDomainCheck | null>(forced ?? null);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [also, setAlso] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const invalidRef = useRef(onInvalidHost);
  invalidRef.current = onInvalidHost;

  useEffect(() => {
    if (forced) return;
    const controller = new AbortController();
    api.checkBlocked(host, controller.signal).then(setCheck, (caught: unknown) => {
      if (isAbort(caught)) return;
      if (caught instanceof ApiError && caught.code === 'invalid_host' && invalidRef.current) {
        invalidRef.current(caught.message);
        return;
      }
      setCheckError(caught instanceof ApiError ? caught.message : 'The domain could not be checked.');
    });
    return () => controller.abort();
  }, [host, forced]);

  const shownHost = check?.host ?? host;
  const active = check?.activePublicLinks ?? 0;
  const covered = check?.blockedBy ?? null;
  const disableActive = active > 0 && also;

  const confirm = async () => {
    if (!check) return;
    if (forced || preview) return onClose();
    setBusy(true);
    setError(null);
    try {
      const result = await api.blockDomain(check.host, disableActive);
      const host = result.domain.host;
      toast(result.disabled > 0 ? `${host} blocked for public links. Existing links disabled` : `${host} blocked for public links`);
      onBlocked(result, disableActive);
    } catch (caught) {
      setBusy(false);
      setError(caught instanceof ApiError ? caught.message : 'The domain could not be blocked.');
    }
  };

  return (
    <Dialog kind="alert" level={70} labelledBy="blk-title" describedBy="blk-desc" onClose={onClose} className={styles.blockDialog}>
      <Badge tone="danger" size="sm" wide className={overlays.badgeStart}>
        BLOCK DOMAIN
      </Badge>
      <h2 id="blk-title" className={overlays.deleteTitle}>
        Block {shownHost} for public links?
      </h2>
      <p id="blk-desc" className={overlays.deleteText}>
        New public links to {shownHost} and its subdomains will be rejected on link.daffa.me. Private links are not
        affected. The domain can be removed from the block list later.
      </p>

      {!check && !checkError && <p className={styles.note}>Checking public links on this domain</p>}
      {checkError && (
        <p role="alert" className={overlays.error}>
          {checkError}
        </p>
      )}
      {check && covered !== null && (
        <p className={styles.note}>
          {covered === check.host
            ? `${check.host} is already on the blocked list.`
            : `${check.host} is already blocked through ${covered}.`}
        </p>
      )}
      {check && covered === null && active > 0 && (
        <button
          type="button"
          role="checkbox"
          aria-checked={also}
          className={styles.checkbox}
          onClick={() => setAlso((value) => !value)}
        >
          <span className={styles.box} aria-hidden="true">
            {also && <CheckIcon />}
          </span>
          <span className={styles.checkText}>
            <span className={styles.checkLabel}>
              {active === 1
                ? `Also disable the existing public link to ${check.host}`
                : `Also disable all ${formatNumber(active)} existing public links to ${check.host}`}
            </span>
            <span className={styles.checkHelp}>Disabled links keep their slugs reserved and can be enabled again later.</span>
          </span>
        </button>
      )}
      {check && covered === null && active === 0 && (
        <p className={styles.note}>No active public links point to this domain.</p>
      )}

      {error && (
        <p role="alert" className={overlays.error}>
          {error}
        </p>
      )}
      <div className={overlays.deleteActions}>
        {/* One element for Cancel and Close, so focus stays on it when the check answers. */}
        <Button variant="secondary" onClick={onClose} data-autofocus>
          {covered !== null ? 'Close' : 'Cancel'}
        </Button>
        {covered === null && (
          <Button variant="danger" onClick={confirm} disabled={!check || busy} aria-busy={busy}>
            {busy ? 'Blocking' : 'Block Domain'}
          </Button>
        )}
      </div>
    </Dialog>
  );
}

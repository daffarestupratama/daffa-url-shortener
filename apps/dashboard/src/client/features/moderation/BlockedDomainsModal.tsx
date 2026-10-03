import type { BlockDomainResult, BlockedDomainList } from '@daffa/shared';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Button, IconButton } from '../../components/controls';
import { Field, FieldError, Label, TextInput } from '../../components/fields';
import { SearchIcon } from '../../components/Icons';
import { Dialog } from '../../components/overlay';
import { api, ApiError } from '../../lib/api';
import { formatDateTime, formatNumber } from '../../lib/format';
import { useResource } from '../../lib/useResource';
import { useApp } from '../app/AppProvider';
import overlays from '../overlays/overlays.module.css';
import { BlockDomainDialog } from './BlockDomainDialog';
import styles from './moderation.module.css';

interface BlockedDomainsModalProps {
  /** Pre-filled search, such as the host of a row whose domain is already blocked. */
  initialQuery?: string;
  /** True when a domain was added or removed while the modal was open. */
  onClose: (changed: boolean) => void;
  /** A domain was added from the field, after the Block dialog confirmed it. */
  onBlocked: (result: BlockDomainResult, disableActive: boolean) => void;
  /** A domain was removed. */
  onRemoved: () => void;
  /** Dev preview only: this list instead of a request. */
  forced?: BlockedDomainList;
  /** Dev preview only: Remove closes the modal, and the Block dialog of the add field only closes. */
  preview?: boolean;
}

const domainCount = (n: number) => (n === 1 ? '1 domain' : `${formatNumber(n)} domains`);

/**
 * Every hostname refused for new public links, newest first. Searching asks
 * the API, 250 ms after typing stops. Adding a domain opens the same Block
 * dialog a row uses, stacked above, so existing links can be disabled too.
 */
export function BlockedDomainsModal({
  initialQuery = '',
  onClose,
  onBlocked,
  onRemoved,
  forced,
  preview = false,
}: BlockedDomainsModalProps) {
  const { toast } = useApp();
  const [searchText, setSearchText] = useState(initialQuery);
  const [q, setQ] = useState(initialQuery.trim());
  const [reloads, setReloads] = useState(0);
  const [addText, setAddText] = useState('');
  const [addError, setAddError] = useState<string | null>(null);
  const [blockHost, setBlockHost] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const changed = useRef(false);
  const addInput = useRef<HTMLInputElement>(null);
  const well = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const next = searchText.trim();
    if (next === q) return;
    const timer = window.setTimeout(() => setQ(next), 250);
    return () => window.clearTimeout(timer);
  }, [searchText, q]);

  const list = useResource(forced ? null : `blocked:${q}:${reloads}`, (signal) => api.blockedDomains(q, signal));
  const data = forced ?? list.data;
  const total = data?.total ?? 0;
  const domains = data?.domains ?? [];

  const close = () => onClose(changed.current);

  const add = (event: FormEvent) => {
    event.preventDefault();
    const host = addText.trim();
    if (!host) {
      setAddError('Enter a domain name such as example.com.');
      addInput.current?.focus();
      return;
    }
    setAddError(null);
    setBlockHost(host);
  };

  const remove = async (host: string) => {
    if (forced || preview) return close();
    setRemoving(host);
    try {
      await api.unblockDomain(host);
      // Links the block disabled may have been abusive, so they stay off until enabled one by one.
      toast(`${host} removed from blocked domains. Links disabled by the block stay disabled`, { duration: 5000 });
      changed.current = true;
      setReloads((n) => n + 1);
      onRemoved();
      // The row and its button go away, so focus moves to the list itself.
      (well.current ?? addInput.current)?.focus();
    } catch (caught) {
      toast(caught instanceof ApiError ? caught.message : 'The domain could not be removed.');
    } finally {
      setRemoving(null);
    }
  };

  return (
    <>
      <Dialog kind="dialog" level={60} labelledBy="bl-title" onClose={close} className={styles.listDialog}>
        <div className={overlays.head}>
          <div className={overlays.headText}>
            <span className={overlays.kicker}>PUBLIC LINKS</span>
            <h2 id="bl-title" className={styles.listTitle}>
              Blocked Domains
            </h2>
          </div>
          <IconButton size={44} label="Close" onClick={close}>
            {'×'}
          </IconButton>
        </div>
        <p className={styles.desc}>
          New public links to these domains and their subdomains are rejected. Removing a domain does not re-enable
          links that the block disabled.
        </p>

        <form onSubmit={add} noValidate>
          <Field>
            <Label htmlFor="bl-add">Add a domain</Label>
            <div className={styles.addRow}>
              <TextInput
                ref={addInput}
                id="bl-add"
                mono
                data-autofocus
                className={styles.addInput}
                value={addText}
                placeholder="example.com"
                autoComplete="off"
                spellCheck={false}
                state={addError ? 'invalid' : null}
                aria-describedby={addError ? 'bl-add-error' : undefined}
                onChange={(event) => {
                  setAddText(event.target.value);
                  setAddError(null);
                }}
              />
              <Button type="submit" variant="dangerOutline">
                Block Domain
              </Button>
            </div>
            {addError && <FieldError id="bl-add-error">{addError}</FieldError>}
          </Field>
        </form>

        {data === null && list.error === null && <div className={styles.wellMessage}>Loading blocked domains</div>}
        {data === null && list.error !== null && (
          <div className={styles.wellMessage} role="alert">
            Blocked domains failed to load.{' '}
            <Button variant="secondary" size="sm" onClick={list.reload}>
              Reload
            </Button>
          </div>
        )}

        {data !== null && total === 0 && <div className={styles.wellMessage}>No blocked domains.</div>}

        {data !== null && total > 0 && (
          <div className={styles.searchBlock}>
            <label className={styles.search}>
              <span className="visually-hidden">Search blocked domains</span>
              <SearchIcon className={styles.searchIcon} />
              <input
                type="search"
                className={styles.searchInput}
                value={searchText}
                placeholder="Search hostname"
                spellCheck={false}
                onChange={(event) => setSearchText(event.target.value)}
              />
            </label>
            <span aria-live="polite" className={styles.caption}>
              {q ? `${formatNumber(domains.length)} of ${domainCount(total)}` : domainCount(total)}
            </span>
          </div>
        )}

        {data !== null && total > 0 && domains.length === 0 && (
          <div className={styles.wellMessage}>No blocked domain matches the search.</div>
        )}

        {domains.length > 0 && (
          <div ref={well} tabIndex={0} aria-label="Blocked domain list" className={styles.well}>
            {domains.map((domain) => (
              <div key={domain.host} className={styles.domainRow}>
                <div className={styles.domainText}>
                  <span className={styles.domainHost}>{domain.host}</span>
                  <span className={styles.domainAdded}>Added {formatDateTime(domain.createdAt)}</span>
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  aria-label={`Remove ${domain.host} from blocked domains`}
                  disabled={removing !== null}
                  aria-busy={removing === domain.host}
                  onClick={() => remove(domain.host)}
                >
                  {removing === domain.host ? 'Removing' : 'Remove'}
                </Button>
              </div>
            ))}
          </div>
        )}
      </Dialog>

      {blockHost !== null && (
        <BlockDomainDialog
          host={blockHost}
          preview={preview}
          onClose={() => setBlockHost(null)}
          onInvalidHost={(message) => {
            setBlockHost(null);
            setAddError(message);
            addInput.current?.focus();
          }}
          onBlocked={(result, disableActive) => {
            setBlockHost(null);
            setAddText('');
            changed.current = true;
            setReloads((n) => n + 1);
            onBlocked(result, disableActive);
          }}
        />
      )}
    </>
  );
}

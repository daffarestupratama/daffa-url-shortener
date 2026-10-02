import { useEffect, useRef } from 'react';
import { FieldError } from '../components/fields';
import { loadTurnstile, turnstileSiteKey, type TurnstileApi } from './turnstile';
import styles from './public.module.css';

const cx = (...names: Array<string | false | null | undefined>) => names.filter(Boolean).join(' ');

/**
 * Why the slot asks for attention: the check failed or expired, a Create Link
 * press came before any token, or the script could not load at all.
 */
export type TurnstileError = 'failed' | 'pending' | 'offline';

const MESSAGES: Record<TurnstileError, string> = {
  failed: 'Verification failed or expired. Complete the check again, then press Create Link.',
  pending: 'Complete the verification check, then press Create Link.',
  offline: 'The verification check could not be loaded. Check the connection, then reload the page.',
};

export const TURNSTILE_ERROR_ID = 'p-ts-error';

interface TurnstileSlotProps {
  error: TurnstileError | null;
  /** A new token, or null once the current one is used up, expired, or reset. */
  onToken: (token: string | null) => void;
  onError: (error: TurnstileError) => void;
  /** Changing it resets the widget: tokens are single use, so this follows every submit. */
  resetKey: number;
  /** False in the dev previews that force a Turnstile state, which show the empty slot instead. */
  load?: boolean;
}

/**
 * The 300 x 65 area the design reserves for Cloudflare Turnstile. The widget
 * renders into it explicitly once the script has loaded. Until then, and in
 * the forced previews, the slot shows its placeholder.
 */
export function TurnstileSlot({ error, onToken, onError, resetKey, load = true }: TurnstileSlotProps) {
  const host = useRef<HTMLDivElement>(null);
  const widget = useRef<{ api: TurnstileApi; id: string } | null>(null);
  const handlers = useRef({ onToken, onError });
  handlers.current = { onToken, onError };

  useEffect(() => {
    if (!load) return;
    let active = true;
    loadTurnstile().then(
      (api) => {
        const element = host.current;
        if (!active || !element) return;
        const id = api.render(element, {
          sitekey: turnstileSiteKey(),
          theme: 'light',
          size: 'normal',
          'refresh-expired': 'auto',
          callback: (token) => handlers.current.onToken(token),
          // An expired token is replaced automatically. Until then there is none to send.
          'expired-callback': () => handlers.current.onToken(null),
          'error-callback': () => {
            handlers.current.onToken(null);
            handlers.current.onError('failed');
            return true;
          },
          'timeout-callback': () => {
            handlers.current.onToken(null);
            handlers.current.onError('failed');
          },
        });
        if (id) widget.current = { api, id };
      },
      () => {
        if (active) handlers.current.onError('offline');
      },
    );
    return () => {
      active = false;
      if (widget.current) widget.current.api.remove(widget.current.id);
      widget.current = null;
    };
  }, [load]);

  const firstReset = useRef(true);
  useEffect(() => {
    if (firstReset.current) {
      firstReset.current = false;
      return;
    }
    handlers.current.onToken(null);
    if (widget.current) widget.current.api.reset(widget.current.id);
  }, [resetKey]);

  return (
    <div className={styles.tsField}>
      <div className={cx(styles.tsSlot, error && styles.tsSlotError)}>
        <span className={cx(styles.tsPlaceholder, error === 'failed' && styles.tsPlaceholderError)} aria-hidden="true">
          {error === 'failed' ? 'FAILED OR EXPIRED' : 'CLOUDFLARE TURNSTILE'}
        </span>
        <div ref={host} className={styles.tsHost} />
      </div>
      {error && <FieldError id={TURNSTILE_ERROR_ID}>{MESSAGES[error]}</FieldError>}
    </div>
  );
}

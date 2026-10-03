import { useEffect, useRef, useState, type RefObject } from 'react';
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

/** Width of the normal widget. Below it, the compact widget of 150 x 140 is used. */
const NORMAL_WIDTH = 300;

type WidgetSize = 'normal' | 'compact';

/**
 * The widget size that fits the room the form gives the slot, measured, then
 * watched with a ResizeObserver. Null until the first measurement, so the
 * widget never renders at a size it then has to replace. Only a change of
 * size class causes a new value, never a resize within one class.
 */
function useWidgetSize(ref: RefObject<HTMLElement | null>): WidgetSize | null {
  const [size, setSize] = useState<WidgetSize | null>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => setSize(element.getBoundingClientRect().width < NORMAL_WIDTH ? 'compact' : 'normal');
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return size;
}

/**
 * The area the design reserves for Cloudflare Turnstile. The widget
 * renders into it explicitly once the script has loaded. Until then, and in
 * the forced previews, the slot shows its placeholder.
 */
export function TurnstileSlot({ error, onToken, onError, resetKey, load = true }: TurnstileSlotProps) {
  const field = useRef<HTMLDivElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const widget = useRef<{ api: TurnstileApi; id: string } | null>(null);
  const handlers = useRef({ onToken, onError });
  handlers.current = { onToken, onError };
  const size = useWidgetSize(field);

  useEffect(() => {
    if (!load || size === null) return;
    let active = true;
    loadTurnstile().then(
      (api) => {
        const element = host.current;
        if (!active || !element) return;
        const id = api.render(element, {
          sitekey: turnstileSiteKey(),
          theme: 'light',
          size,
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
      if (widget.current) {
        widget.current.api.remove(widget.current.id);
        // A token belongs to the widget that issued it. When the slot changes
        // size, the next widget has to verify again.
        handlers.current.onToken(null);
      }
      widget.current = null;
    };
  }, [load, size]);

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
    <div ref={field} className={styles.tsField}>
      <div className={cx(styles.tsSlot, size === 'compact' && styles.tsSlotCompact, error && styles.tsSlotError)}>
        <span className={cx(styles.tsPlaceholder, error === 'failed' && styles.tsPlaceholderError)} aria-hidden="true">
          {error === 'failed' ? 'FAILED OR EXPIRED' : 'CLOUDFLARE TURNSTILE'}
        </span>
        <div ref={host} className={styles.tsHost} />
      </div>
      {error && <FieldError id={TURNSTILE_ERROR_ID}>{MESSAGES[error]}</FieldError>}
    </div>
  );
}

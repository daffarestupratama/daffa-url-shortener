import { useRef, type ReactNode } from 'react';
import { useEscapeLayer, useFocusTrap } from '../lib/focus';
import styles from './overlay.module.css';

const cx = (...names: Array<string | false | null | undefined>) => names.filter(Boolean).join(' ');

interface DrawerProps {
  labelledBy: string;
  onClose: () => void;
  children: ReactNode;
}

/** The create and edit form: a right hand drawer over a scrim that closes it. */
export function Drawer({ labelledBy, onClose, children }: DrawerProps) {
  const ref = useRef<HTMLElement>(null);
  useFocusTrap(ref, true);
  useEscapeLayer(true, onClose);
  return (
    <>
      <div className={styles.formScrim} onClick={onClose} aria-hidden="true" />
      <aside ref={ref} role="dialog" aria-modal="true" aria-labelledby={labelledBy} className={styles.drawer}>
        {children}
      </aside>
    </>
  );
}

interface DialogProps {
  labelledBy: string;
  describedBy?: string;
  onClose: () => void;
  /**
   * A dialog closes on a scrim click. An alert dialog asks for a decision, so
   * only its buttons and Escape close it.
   */
  kind: 'dialog' | 'alert';
  /** Stacking from the design: 60 for the QR, rate limit and blocked domains layers, 70 for confirmations. */
  level: 60 | 70;
  className?: string;
  children: ReactNode;
}

export function Dialog({ labelledBy, describedBy, onClose, kind, level, className, children }: DialogProps) {
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref, true);
  useEscapeLayer(true, onClose);
  const alert = kind === 'alert';
  return (
    <div
      className={cx(styles.center, level === 70 ? styles.level70 : styles.level60)}
      onClick={alert ? undefined : (event) => event.target === event.currentTarget && onClose()}
    >
      <div
        ref={ref}
        role={alert ? 'alertdialog' : 'dialog'}
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        tabIndex={-1}
        className={cx(styles.dialog, className)}
      >
        {children}
      </div>
    </div>
  );
}

export function ToastView({ message }: { message: string | null }) {
  // The live region always exists so screen readers announce each new message.
  return (
    <div role="status" aria-live="polite" aria-atomic="true">
      {message && (
        <div className={styles.toast}>
          <span className={styles.toastDot} aria-hidden="true" />
          {message}
        </div>
      )}
    </div>
  );
}

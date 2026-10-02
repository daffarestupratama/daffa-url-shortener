import type { InputHTMLAttributes, ReactNode, Ref, TextareaHTMLAttributes } from 'react';
import styles from './fields.module.css';

const cx = (...names: Array<string | false | null | undefined>) => names.filter(Boolean).join(' ');

export const fieldStyles = styles;

export function Field({ children }: { children: ReactNode }) {
  return <div className={styles.field}>{children}</div>;
}

export function Label({ htmlFor, id, children, required, optional }: { htmlFor?: string; id?: string; children: ReactNode; required?: boolean; optional?: boolean }) {
  return (
    <label htmlFor={htmlFor} id={id} className={styles.label}>
      {children}
      {required && <span className={styles.required}> *</span>}
      {optional && <span className={styles.optional}> (optional)</span>}
    </label>
  );
}

interface TextInputProps extends InputHTMLAttributes<HTMLInputElement> {
  mono?: boolean;
  state?: 'invalid' | 'valid' | null;
  /** React 19 passes refs as an ordinary prop, so this reaches the input through the spread. */
  ref?: Ref<HTMLInputElement>;
}

export function TextInput({ mono, state, className, ...rest }: TextInputProps) {
  return (
    <input
      className={cx(styles.input, mono && styles.mono, state === 'invalid' && styles.invalid, state === 'valid' && styles.valid, className)}
      aria-invalid={state === 'invalid' ? true : undefined}
      {...rest}
    />
  );
}

export function TextArea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cx(styles.input, styles.textarea, className)} {...rest} />;
}

export function Help({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <span id={id} className={styles.help}>
      {children}
    </span>
  );
}

/** The normalized destination under a URL field, such as "Saved as https://example.com". */
export function Preview({ id, url }: { id?: string; url: string }) {
  return (
    <span id={id} className={styles.preview}>
      Saved as {url}
    </span>
  );
}

export function FieldError({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <span id={id} role="alert" className={cx(styles.message, styles.messageError)}>
      <span className={styles.dot} aria-hidden="true">
        !
      </span>
      {children}
    </span>
  );
}

export function FieldOk({ children }: { children: ReactNode }) {
  return (
    <span className={cx(styles.message, styles.messageOk)}>
      <span className={styles.dot} aria-hidden="true">
        {'✓'}
      </span>
      {children}
    </span>
  );
}

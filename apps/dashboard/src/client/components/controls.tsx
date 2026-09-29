import {
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type KeyboardEvent,
} from 'react';
import { useDismiss, useEscapeLayer } from '../lib/focus';
import styles from './controls.module.css';

const cx = (...names: Array<string | false | null | undefined>) => names.filter(Boolean).join(' ');

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'dangerOutline';
export type ButtonSize = 'lg' | 'md' | 'sm';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

/** Raised means clickable. Pressed turns inset. The border keeps it visible when shadows are off. */
export function Button({ variant = 'secondary', size = 'lg', className, type = 'button', ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      className={cx(styles.button, styles[variant], styles[size], className)}
      {...rest}
    />
  );
}

/** The same look for an anchor, used by links that navigate. */
export function buttonClass(variant: ButtonVariant = 'secondary', size: ButtonSize = 'lg', extra?: string): string {
  return cx(styles.button, styles[variant], styles[size], extra);
}

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  size?: 36 | 40 | 44;
  label: string;
}

export function IconButton({ size = 40, label, className, type = 'button', ...rest }: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={cx(styles.icon, styles[`icon${size}`], className)}
      {...rest}
    />
  );
}

interface SegmentedProps<T extends string> {
  label: string;
  options: ReadonlyArray<readonly [T, string]>;
  value: T;
  onChange: (value: T) => void;
  compact?: boolean;
  className?: string;
}

/** The active option looks inset and bold. Arrow keys move the selection, as in a radio group. */
export function SegmentedControl<T extends string>({ label, options, value, onChange, compact, className }: SegmentedProps<T>) {
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = options.findIndex(([key]) => key === value);
    const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0;
    if (!step || index === -1) return;
    event.preventDefault();
    const next = options[(index + step + options.length) % options.length]!;
    onChange(next[0]);
    const buttons = event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]');
    buttons[(index + step + options.length) % options.length]?.focus();
  };

  return (
    <div role="radiogroup" aria-label={label} className={cx(styles.segmented, className)} onKeyDown={onKeyDown}>
      {options.map(([key, text]) => {
        const checked = key === value;
        return (
          <button
            key={key}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            className={cx(styles.segment, compact && styles.segmentCompact)}
            onClick={() => onChange(key)}
          >
            {text}
          </button>
        );
      })}
    </div>
  );
}

interface DropdownProps<T extends string> {
  label: string;
  options: ReadonlyArray<readonly [T, string]>;
  value: T;
  onChange: (value: T) => void;
  align?: 'left' | 'right';
  defaultOpen?: boolean;
}

export function Dropdown<T extends string>({ label, options, value, onChange, align = 'left', defaultOpen = false }: DropdownProps<T>) {
  const [open, setOpen] = useState(defaultOpen);
  const root = useRef<HTMLDivElement>(null);
  const close = () => setOpen(false);
  useDismiss(root, open, close);
  useEscapeLayer(open, close);

  const current = options.find(([key]) => key === value) ?? options[0];

  return (
    <div className={styles.dropdown} ref={root}>
      <button
        type="button"
        className={styles.trigger}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={label}
        onClick={() => setOpen((o) => !o)}
      >
        {current?.[1]}
      </button>
      <span className={styles.caret} aria-hidden="true">
        {'▾'}
      </span>
      {open && (
        <div role="listbox" aria-label={label} className={cx(styles.listbox, align === 'left' ? styles.alignLeft : styles.alignRight)}>
          {options.map(([key, text]) => {
            const selected = key === value;
            return (
              <button
                key={key}
                type="button"
                role="option"
                aria-selected={selected}
                className={styles.option}
                onClick={() => {
                  onChange(key);
                  close();
                }}
              >
                <span>{text}</span>
                <span aria-hidden="true" className={styles.check}>
                  {selected ? '✓' : ''}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  labelledBy?: string;
  label?: string;
}

/** Inset track, raised knob. A native button, so Space and Enter both toggle it. */
export function Switch({ checked, onChange, labelledBy, label }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-labelledby={labelledBy}
      aria-label={labelledBy ? undefined : label}
      className={styles.switch}
      onClick={() => onChange(!checked)}
    >
      <span className={styles.knob} />
    </button>
  );
}

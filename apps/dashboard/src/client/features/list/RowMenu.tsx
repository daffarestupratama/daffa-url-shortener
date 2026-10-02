import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { IconButton } from '../../components/controls';
import { KebabIcon } from '../../components/Icons';
import { useDismiss, useEscapeLayer } from '../../lib/focus';
import styles from './list.module.css';

const cx = (...names: Array<string | false | null | undefined>) => names.filter(Boolean).join(' ');

export type RowMenuItem =
  | {
      label: string;
      onSelect: () => void;
      /** danger for destructive actions, muted for the grey "Domain already blocked" item. */
      tone?: 'danger' | 'muted';
      disabled?: boolean;
    }
  | 'divider';

interface RowMenuProps {
  /** Names the menu for assistive technology, such as "Actions for daffa.me/cv". */
  label: string;
  items: readonly RowMenuItem[];
  defaultOpen?: boolean;
}

/**
 * The More actions menu of a row. Opening it focuses the first item, arrow
 * keys, Home and End move between items, Escape closes it and returns focus
 * to the button, and Tab closes it and moves on. Choosing an item puts focus
 * back on the button first, so a dialog the item opens returns focus there.
 * The wrapper uses display: contents, so the menu still positions against the
 * action group of the row.
 */
export function RowMenu({ label, items, defaultOpen = false }: RowMenuProps) {
  const [open, setOpen] = useState(defaultOpen);
  const wrap = useRef<HTMLDivElement>(null);
  const openedByUser = useRef(false);

  const trigger = () => wrap.current?.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]') ?? null;
  const menuItems = () => [
    ...(wrap.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? []),
  ];

  const close = (focusTrigger: boolean) => {
    setOpen(false);
    if (focusTrigger) trigger()?.focus();
  };

  useDismiss(wrap, open, () => setOpen(false));
  useEscapeLayer(open, () => close(true));

  useEffect(() => {
    if (open && openedByUser.current) menuItems()[0]?.focus();
  }, [open]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Tab') {
      setOpen(false);
      return;
    }
    const list = menuItems();
    if (list.length === 0) return;
    const index = list.indexOf(document.activeElement as HTMLButtonElement);
    let next: number | null = null;
    if (event.key === 'ArrowDown') next = (index + 1) % list.length;
    else if (event.key === 'ArrowUp') next = (index - 1 + list.length) % list.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = list.length - 1;
    if (next === null) return;
    event.preventDefault();
    list[next]?.focus();
  };

  return (
    <div ref={wrap} className={styles.menuWrap}>
      <IconButton
        label="More actions"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          openedByUser.current = true;
          setOpen((o) => !o);
        }}
      >
        <KebabIcon />
      </IconButton>
      {open && (
        <div role="menu" aria-label={label} className={styles.menu} onKeyDown={onKeyDown}>
          {items.map((item, index) =>
            item === 'divider' ? (
              <div key={`divider-${index}`} className={styles.menuDivider} role="separator" />
            ) : (
              <button
                key={item.label}
                type="button"
                role="menuitem"
                className={cx(
                  styles.menuItem,
                  item.tone === 'danger' && styles.menuDanger,
                  item.tone === 'muted' && styles.menuMuted,
                )}
                disabled={item.disabled}
                onClick={() => {
                  close(true);
                  item.onSelect();
                }}
              >
                {item.label}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}

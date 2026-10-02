import { STATUS_META, type LinkStatus } from '@daffa/shared';
import type { ReactNode } from 'react';
import styles from './tiles.module.css';

const cx = (...names: Array<string | false | null | undefined>) => names.filter(Boolean).join(' ');

export type TileVariant = 'row' | 'kpi' | 'detail' | 'preview' | 'qr' | 'empty' | 'result';

interface GateTileProps {
  slug: string;
  variant: TileVariant;
  /** Rows and KPIs show "/slug". Detail, preview, QR and the public result show "daffa.me/slug". */
  prefix?: 'slash' | 'domain';
  className?: string;
}

export function GateTile({ slug, variant, prefix = 'slash', className }: GateTileProps) {
  return (
    <span className={cx(styles.tile, styles[variant], className)} title={variant === 'row' ? `daffa.me/${slug}` : undefined}>
      <span className={styles.prefix}>{prefix === 'domain' ? 'daffa.me/' : '/'}</span>
      {slug}
    </span>
  );
}

export function LogoTile() {
  return (
    <span className={cx(styles.tile, styles.logo)} aria-hidden="true">
      <span className={styles.prefix}>/</span>
      <span>D</span>
    </span>
  );
}

export type BadgeTone = 'ok' | 'off' | 'exp' | 'danger' | 'bot';
export type BadgeSize = 'xs' | 'sm' | 'md' | 'lg';

interface BadgeProps {
  tone: BadgeTone;
  size?: BadgeSize;
  wide?: boolean;
  children: ReactNode;
  className?: string;
}

export function Badge({ tone, size = 'sm', wide, children, className }: BadgeProps) {
  return <span className={cx(styles.badge, styles[tone], styles[size], wide && styles.wide, className)}>{children}</span>;
}

const STATUS_TONE: Record<LinkStatus, BadgeTone> = { active: 'ok', inactive: 'off', expired: 'exp' };

export function StatusBadge({ status, size = 'sm', className }: { status: LinkStatus; size?: BadgeSize; className?: string }) {
  return (
    <Badge tone={STATUS_TONE[status]} size={size} className={className}>
      {STATUS_META[status].label}
    </Badge>
  );
}

export function Tag({ name, size = 'small' }: { name: string; size?: 'small' | 'medium' }) {
  return <span className={cx(styles.tag, styles[size])}>#{name}</span>;
}

export function RemovableTag({ name, onRemove }: { name: string; onRemove: () => void }) {
  return (
    <span className={styles.removable}>
      #{name}
      <button type="button" className={styles.remove} aria-label={`Remove tag ${name}`} onClick={onRemove}>
        {'×'}
      </button>
    </span>
  );
}

export function AddChip({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" className={styles.addChip} onClick={onClick}>
      + {label}
    </button>
  );
}

export function Kicker({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={cx(styles.kicker, className)}>
      <span className={styles.marker} aria-hidden="true" />
      {children}
    </span>
  );
}

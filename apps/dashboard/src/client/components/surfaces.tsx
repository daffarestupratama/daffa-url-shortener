import type { CSSProperties, HTMLAttributes, ReactNode } from 'react';
import styles from './surfaces.module.css';

const cx = (...names: Array<string | false | null | undefined>) => names.filter(Boolean).join(' ');

export function Panel({ className, ...rest }: HTMLAttributes<HTMLElement>) {
  return <section className={cx(styles.panel, className)} {...rest} />;
}

export function PanelHeader({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx(styles.panelHeader, className)}>{children}</div>;
}

export function PanelTitle({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cx(styles.title, className)}>{children}</span>;
}

interface KpiCardProps {
  label: ReactNode;
  value: ReactNode;
  foot?: ReactNode;
  /** Short colored dash before the label, matching the chart legend. */
  legend?: 'ink' | 'link' | 'bot';
  /** Text color for the label and value, for the bot card. */
  tone?: 'link' | 'bot';
  valueClassName?: string;
}

const TONE: Record<'ink' | 'link' | 'bot', string> = { ink: 'var(--ink)', link: 'var(--link)', bot: 'var(--bot)' };

export function KpiCard({ label, value, foot, legend, tone, valueClassName }: KpiCardProps) {
  const toneColor = tone ? TONE[tone] : undefined;
  return (
    <div className={styles.kpi}>
      <span className={styles.kpiLabel} style={tone === 'bot' ? { color: toneColor } : undefined}>
        {legend && <span className={styles.legend} style={{ background: TONE[legend] }} aria-hidden="true" />}
        {label}
      </span>
      <span className={cx(styles.kpiValue, valueClassName)} style={toneColor ? { color: toneColor } : undefined}>
        {value}
      </span>
      {foot !== undefined && <span className={styles.kpiFoot}>{foot}</span>}
    </div>
  );
}

interface SkeletonProps {
  width: CSSProperties['width'];
  height: number;
  radius?: number;
  tone?: 1 | 2;
}

export function Skeleton({ width, height, radius = 4, tone = 1 }: SkeletonProps) {
  return (
    <span
      aria-hidden="true"
      className={cx(styles.skeleton, tone === 1 ? styles.tone1 : styles.tone2)}
      style={{ width, height, borderRadius: radius }}
    />
  );
}

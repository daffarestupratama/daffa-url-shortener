import { useEffect, useState } from 'react';
import { Button } from '../components/controls';
import { Dialog } from '../components/overlay';
import { Badge } from '../components/tiles';
import { countdownParts } from '../lib/countdown';
import styles from './public.module.css';

export type RateScope = 'visitor' | 'global';

export interface RateLimit {
  scope: RateScope;
  /** Epoch ms when creation opens again, the start of the next clock hour. */
  resetAt: number;
}

/** The design copy of the two limits. The server sends the same sentences. */
const COPY: Record<RateScope, { badge: string; tone: 'exp' | 'danger'; title: string; text: string }> = {
  visitor: {
    badge: 'LIMIT REACHED',
    tone: 'exp',
    title: 'Hourly link limit reached',
    text: 'Each visitor can create up to 5 public links per hour. Link creation becomes available again at the start of the next hour.',
  },
  global: {
    badge: 'CAPACITY FULL',
    tone: 'danger',
    title: 'Public capacity reached for this hour',
    text: 'The shared capacity for public links in this hour has been used by all visitors. Link creation becomes available again for everyone at the start of the next hour.',
  },
};

/** One of the two rate limit dialogs, with a countdown board in WIB that ticks every second. */
export function RateLimitDialog({ limit, onClose }: { limit: RateLimit; onClose: () => void }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const copy = COPY[limit.scope];
  const countdown = countdownParts(limit.resetAt, now);

  return (
    <Dialog kind="alert" level={60} labelledBy="rate-title" describedBy="rate-desc" onClose={onClose} className={styles.rateDialog}>
      <Badge tone={copy.tone} size="sm" wide className={styles.badgeStart}>
        {copy.badge}
      </Badge>
      <h2 id="rate-title" className={styles.rateTitle}>
        {copy.title}
      </h2>
      <p id="rate-desc" className={styles.rateText}>
        {copy.text}
      </p>
      <div className={styles.board}>
        <div className={styles.boardTile}>
          <span className={styles.boardLabel}>AVAILABLE AT</span>
          <span className={styles.boardRow}>
            <span className={styles.boardValue}>{countdown.at}</span>
            <span className={styles.boardUnit}>WIB</span>
          </span>
        </div>
        <div className={styles.boardTile}>
          <span className={styles.boardLabel}>TIME REMAINING</span>
          <span role="timer" aria-live="off" className={styles.boardValue}>
            {countdown.left}
          </span>
        </div>
      </div>
      <Button variant="secondary" onClick={onClose} data-autofocus>
        Understood
      </Button>
    </Dialog>
  );
}

import { formatTime } from './format';

export interface Countdown {
  /** The WIB clock time when the limit lifts, "15:00". */
  at: string;
  /** Minutes and seconds left, "27:48", never below "00:00". */
  left: string;
  done: boolean;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** The two tiles of the rate limit dialogs: AVAILABLE AT and TIME REMAINING. */
export function countdownParts(resetAt: number, now: number): Countdown {
  const seconds = Math.max(0, Math.ceil((resetAt - now) / 1000));
  return {
    at: formatTime(resetAt),
    left: `${pad(Math.floor(seconds / 60))}:${pad(seconds % 60)}`,
    done: seconds === 0,
  };
}

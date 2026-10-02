import { describe, expect, it } from 'vitest';
import { countdownParts } from './countdown';

describe('countdownParts', () => {
  it('shows the reset time in WIB and the time left', () => {
    // 07:32:12 UTC is 14:32:12 WIB, and the next hour starts at 15:00 WIB.
    const now = Date.UTC(2026, 9, 3, 7, 32, 12);
    expect(countdownParts(Date.UTC(2026, 9, 3, 8), now)).toEqual({ at: '15:00', left: '27:48', done: false });
  });

  it('wraps to 00:00 WIB at the end of the WIB day', () => {
    const now = Date.UTC(2026, 9, 3, 16, 59, 30);
    expect(countdownParts(Date.UTC(2026, 9, 3, 17), now)).toEqual({ at: '00:00', left: '00:30', done: false });
  });

  it('rounds a partial second up, so the clock never shows zero early', () => {
    const resetAt = Date.UTC(2026, 9, 3, 8);
    expect(countdownParts(resetAt, resetAt - 400).left).toBe('00:01');
  });

  it('stops at 00:00 once the time has passed', () => {
    const resetAt = Date.UTC(2026, 9, 3, 8);
    expect(countdownParts(resetAt, resetAt)).toEqual({ at: '15:00', left: '00:00', done: true });
    expect(countdownParts(resetAt, resetAt + 90_000).left).toBe('00:00');
  });

  it('shows a full hour as 60:00', () => {
    const resetAt = Date.UTC(2026, 9, 3, 8);
    expect(countdownParts(resetAt, resetAt - 3_600_000).left).toBe('60:00');
  });
});

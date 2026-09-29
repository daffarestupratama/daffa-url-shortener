import { describe, expect, it } from 'vitest';
import { STATUS_META, deriveStatus, isServable } from './status';

const NOW = Date.UTC(2026, 8, 27, 7, 32); // 27 Sep 2026, 14:32 WIB
const PAST = NOW - 86_400_000;
const FUTURE = NOW + 86_400_000;

describe('deriveStatus', () => {
  it('reports an active link with no expiry', () => {
    expect(deriveStatus(true, null, NOW)).toBe('active');
  });

  it('reports an active link whose expiry is still ahead', () => {
    expect(deriveStatus(true, FUTURE, NOW)).toBe('active');
  });

  it('reports a deactivated link as inactive', () => {
    expect(deriveStatus(false, null, NOW)).toBe('inactive');
    expect(deriveStatus(false, FUTURE, NOW)).toBe('inactive');
  });

  it('lets a past expiry win over the active switch', () => {
    expect(deriveStatus(true, PAST, NOW)).toBe('expired');
    expect(deriveStatus(false, PAST, NOW)).toBe('expired');
  });

  it('treats an expiry exactly at now as still active', () => {
    expect(deriveStatus(true, NOW, NOW)).toBe('active');
  });
});

describe('isServable', () => {
  it('only serves active links', () => {
    expect(isServable(true, null, NOW)).toBe(true);
    expect(isServable(true, FUTURE, NOW)).toBe(true);
    expect(isServable(false, null, NOW)).toBe(false);
    expect(isServable(true, PAST, NOW)).toBe(false);
  });
});

describe('STATUS_META', () => {
  it('carries the uppercase labels the design shows on the badges', () => {
    expect(STATUS_META.active.label).toBe('ACTIVE');
    expect(STATUS_META.inactive.label).toBe('INACTIVE');
    expect(STATUS_META.expired.label).toBe('EXPIRED');
  });
});

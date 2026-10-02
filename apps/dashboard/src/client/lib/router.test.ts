import { describe, expect, it } from 'vitest';
import { DASHBOARD_BASE, detailPath, matchDetail } from './router';

describe('dashboard routes', () => {
  it('lives under /dashboard', () => {
    expect(DASHBOARD_BASE).toBe('/dashboard');
    expect(detailPath(12)).toBe('/dashboard/links/12');
  });

  it('matches the detail page with or without a trailing slash', () => {
    expect(matchDetail('/dashboard/links/1')).toBe('1');
    expect(matchDetail('/dashboard/links/9/')).toBe('9');
  });

  it('hands back the raw segment for the page to validate', () => {
    expect(matchDetail('/dashboard/links/abc')).toBe('abc');
    expect(matchDetail('/dashboard/links/a%20b')).toBe('a b');
  });

  it('ignores the old address and other paths', () => {
    expect(matchDetail('/links/1')).toBeNull();
    expect(matchDetail('/dashboard')).toBeNull();
    expect(matchDetail('/dashboard/links')).toBeNull();
    expect(matchDetail('/dashboard/links/1/clicks')).toBeNull();
  });
});

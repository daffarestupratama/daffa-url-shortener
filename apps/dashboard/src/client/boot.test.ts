import { describe, expect, it } from 'vitest';
import { resolveBoot } from './boot';

describe('resolveBoot', () => {
  it('starts the public page at the root', () => {
    expect(resolveBoot('/', '')).toEqual({ app: 'public' });
    expect(resolveBoot('/', '?state=success')).toEqual({ app: 'public' });
  });

  it('starts the dashboard for /dashboard and everything under it', () => {
    expect(resolveBoot('/dashboard', '')).toEqual({ app: 'dashboard' });
    expect(resolveBoot('/dashboard/', '')).toEqual({ app: 'dashboard' });
    expect(resolveBoot('/dashboard/links/1', '?range=7d')).toEqual({ app: 'dashboard' });
    expect(resolveBoot('/dashboard/unknown/path', '')).toEqual({ app: 'dashboard' });
  });

  it('sends old detail addresses to the dashboard with a full page load, query kept', () => {
    expect(resolveBoot('/links/1', '')).toEqual({ redirect: '/dashboard/links/1' });
    expect(resolveBoot('/links/9/', '?range=7d&page=2')).toEqual({ redirect: '/dashboard/links/9?range=7d&page=2' });
  });

  it('does not treat lookalike paths as the dashboard', () => {
    expect(resolveBoot('/dashboards', '')).toEqual({ app: 'public', replace: '/' });
    expect(resolveBoot('/links', '')).toEqual({ app: 'public', replace: '/' });
    expect(resolveBoot('/links/1/clicks', '')).toEqual({ app: 'public', replace: '/' });
  });

  it('rewrites any other path to the public page root, query kept', () => {
    expect(resolveBoot('/some/unknown', '')).toEqual({ app: 'public', replace: '/' });
    expect(resolveBoot('/index.html', '?state=filled')).toEqual({ app: 'public', replace: '/?state=filled' });
  });
});

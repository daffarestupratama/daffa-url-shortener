/**
 * Which app the single index.html starts, decided from the path alone before
 * any route code loads. link.daffa.me serves the same document for every
 * path, so this is the only place that tells the public page and the
 * dashboard apart.
 *
 *   /                         the public page
 *   /dashboard, /dashboard/*  the owner dashboard (Cloudflare Access in front)
 *   /links/:id                the old dashboard address. A full page load to
 *                             /dashboard/links/:id, so Access can sign in first
 *   anything else             the public page, with the address rewritten to /
 */

export type BootApp = 'public' | 'dashboard';

export type BootDecision =
  | { app: BootApp; replace?: string }
  /** Leave the page: the dashboard sits behind Access, which only runs on a real navigation. */
  | { redirect: string };

const LEGACY_DETAIL = /^\/links\/([^/]+)\/?$/;

export function resolveBoot(pathname: string, search: string): BootDecision {
  const legacy = LEGACY_DETAIL.exec(pathname);
  if (legacy) return { redirect: `/dashboard/links/${legacy[1]}${search}` };
  if (pathname === '/dashboard' || pathname.startsWith('/dashboard/')) return { app: 'dashboard' };
  if (pathname === '/') return { app: 'public' };
  return { app: 'public', replace: `/${search}` };
}

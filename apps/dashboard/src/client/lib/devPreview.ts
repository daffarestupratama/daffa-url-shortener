/**
 * Development only. Forces a designed state or opens an overlay from the URL,
 * so every state of the dashboard can be compared side by side with the
 * design files. The public page has its own module, public/devPreview.ts.
 *
 *   /dashboard?state=loading | error | empty | noresults | loading-more | budget-warn | budget-full
 *   /dashboard?overlay=create | create-errors | create-ok | create-url | edit | qr | delete
 *                     | menu | tag | sort | toast | blocked | blocked-empty | blocked-nomatch
 *   /dashboard?tab=public&state=loading | error | empty | noresults | loading-more
 *   /dashboard?tab=public&overlay=menu | menu-blocked | public-qr | public-delete
 *                                | block | block-none | block-covered
 *   /dashboard/links/1?state=loading | error | empty | notfound | flat
 *   /dashboard/links/1?overlay=edit | qr | delete | toast
 *
 * Every state name and every preview value lives in this module. Pages only
 * read the flags it returns, and preview.ts only reaches this module behind
 * import.meta.env.DEV, which Vite replaces with false in a build. The whole
 * module, strings included, is therefore absent from production, which
 * scripts/check-bundle.mjs verifies.
 */

import type { BlockedDomainCheck, BlockedDomainList, Link, PublicLinkItem } from '@daffa/shared';

export const DEV_PREVIEW_MARKER = 'daffa-dev-state-preview';

export interface ListFlags {
  loading: boolean;
  error: boolean;
  empty: boolean;
  noResults: boolean;
  tagOpen: boolean;
  sortOpen: boolean;
  /** The menu of the first row of the active tab is open. */
  menuOpen: boolean;
  /** The first public row reads as on a blocked domain, with its menu open. */
  menuBlocked: boolean;
  /** The Load More footer shows its busy state, whether or not more pages follow. */
  loadingMore: boolean;
  /** The public budget KPI forced to this share of the daily budget, or null for the real value. */
  budgetShare: number | null;
}

export interface DetailFlags {
  loading: boolean;
  error: boolean;
  empty: boolean;
  notFound: boolean;
  flat: boolean;
}

interface LinkRef {
  id: number;
  slug: string;
  title: string;
}

/** The parts of the app API the preview drives. */
export interface PreviewActions {
  openCreate: (seed?: { url?: string; slug?: string; tried?: boolean }) => void;
  openEdit: (link: Link) => void;
  openQr: (link: LinkRef) => void;
  openDelete: (link: LinkRef) => void;
  toast: (message: string, options?: { sticky?: boolean }) => void;
}

/** The moderation overlays of the list page, which live in the page rather than the app. */
export interface ModerationPreviewActions {
  openPublicDelete: (link: PublicLinkItem) => void;
  openBlock: (host: string, forced?: BlockedDomainCheck) => void;
  openBlocked: (options: { query?: string; forced?: BlockedDomainList }) => void;
}

/** The first row of each tab, once loaded. Null until then, or when the tab is not shown. */
export interface FirstRows {
  privateLink: Link | null;
  publicLink: PublicLinkItem | null;
}

let announced = false;

function read(search: string): { state: string | null; overlay: string | null } {
  const params = new URLSearchParams(search);
  const state = params.get('state');
  const overlay = params.get('overlay');
  if (!announced && (state || overlay)) {
    announced = true;
    console.info(`[${DEV_PREVIEW_MARKER}]`, { state, overlay });
  }
  return { state, overlay };
}

export function listFlags(search: string): ListFlags {
  const { state, overlay } = read(search);
  return {
    loading: state === 'loading',
    error: state === 'error',
    empty: state === 'empty',
    noResults: state === 'noresults',
    tagOpen: overlay === 'tag',
    sortOpen: overlay === 'sort',
    menuOpen: overlay === 'menu' || overlay === 'menu-blocked',
    menuBlocked: overlay === 'menu-blocked',
    loadingMore: state === 'loading-more',
    budgetShare: state === 'budget-warn' ? 0.75 : state === 'budget-full' ? 0.95 : null,
  };
}

export function detailFlags(search: string): DetailFlags {
  const { state } = read(search);
  return {
    loading: state === 'loading',
    error: state === 'error',
    empty: state === 'empty',
    notFound: state === 'notfound',
    flat: state === 'flat',
  };
}

/**
 * Opens the overlay named in the URL on the list page. Returns false while it
 * still needs a first row to load, true once handled or when there is nothing
 * to do. Moderation overlays opened here never change data: their confirm
 * buttons only close them.
 */
export function applyListOverlay(
  search: string,
  actions: PreviewActions & ModerationPreviewActions,
  first: FirstRows,
): boolean {
  const { overlay } = read(search);
  const pub = first.publicLink;
  switch (overlay) {
    case 'create':
      actions.openCreate();
      return true;
    case 'create-errors':
      // Both field errors at once: an invalid URL and a reserved slug.
      actions.openCreate({ url: 'not a url', slug: 'admin', tried: true });
      return true;
    case 'create-ok':
      // A free slug, confirmed by the availability check.
      actions.openCreate({ url: 'https://example.com/talk-2026', slug: 'talk-2026' });
      return true;
    case 'create-url':
      // No scheme typed, so the field shows the "Saved as" preview.
      actions.openCreate({ url: 'example.com/talk-2026', slug: 'talk-2026' });
      return true;
    case 'toast':
      actions.toast('daffa.me/cv copied to clipboard', { sticky: true });
      return true;
    case 'blocked':
      actions.openBlocked({});
      return true;
    case 'blocked-empty':
      actions.openBlocked({ forced: { domains: [], total: 0 } });
      return true;
    case 'blocked-nomatch':
      actions.openBlocked({ query: 'no-such-domain.example' });
      return true;
    case 'edit':
    case 'qr':
    case 'delete': {
      const link = first.privateLink;
      if (!link) return false;
      const ref = { id: link.id, slug: link.slug, title: link.title };
      if (overlay === 'edit') actions.openEdit(link);
      else if (overlay === 'qr') actions.openQr(ref);
      else actions.openDelete(ref);
      return true;
    }
    case 'public-qr':
      if (!pub) return false;
      actions.openQr({ id: pub.id, slug: pub.slug, title: pub.host });
      return true;
    case 'public-delete':
      if (!pub) return false;
      actions.openPublicDelete(pub);
      return true;
    case 'block':
      if (!pub) return false;
      actions.openBlock(pub.host);
      return true;
    case 'block-none':
      if (!pub) return false;
      actions.openBlock(pub.host, { host: pub.host, blockedBy: null, activePublicLinks: 0 });
      return true;
    case 'block-covered':
      if (!pub) return false;
      actions.openBlock(pub.host, { host: pub.host, blockedBy: pub.host, activePublicLinks: 2 });
      return true;
    default:
      return true;
  }
}

/** The same for the detail page, once its link has loaded. */
export function applyDetailOverlay(search: string, actions: PreviewActions, link: Link | null): boolean {
  const { overlay } = read(search);
  if (overlay !== 'edit' && overlay !== 'qr' && overlay !== 'delete' && overlay !== 'toast') return true;
  if (!link) return false;
  const ref = { id: link.id, slug: link.slug, title: link.title };
  if (overlay === 'edit') actions.openEdit(link);
  else if (overlay === 'qr') actions.openQr(ref);
  else if (overlay === 'delete') actions.openDelete(ref);
  else actions.toast(`daffa.me/${link.slug} copied to clipboard`, { sticky: true });
  return true;
}

/**
 * Development only. Forces a designed state or opens an overlay from the URL,
 * so every state can be compared side by side with the design files:
 *
 *   /?state=loading | error | empty | noresults
 *   /?overlay=create | create-errors | create-ok | edit | qr | delete | menu | tag | sort | toast
 *   /links/1?state=loading | error | empty | notfound | flat
 *   /links/1?overlay=edit | qr | delete | toast
 *
 * Every state name and every preview value lives in this module. Pages only
 * read the boolean flags it returns, and preview.ts only reaches this module
 * behind import.meta.env.DEV, which Vite replaces with false in a build. The
 * whole module, strings included, is therefore absent from production, which
 * scripts/check-bundle.mjs verifies.
 */

import type { Link } from '@daffa/shared';

export const DEV_PREVIEW_MARKER = 'daffa-dev-state-preview';

export interface ListFlags {
  loading: boolean;
  error: boolean;
  empty: boolean;
  noResults: boolean;
  tagOpen: boolean;
  sortOpen: boolean;
  menuOpen: boolean;
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
    menuOpen: overlay === 'menu',
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
 * still needs the first link to load, true once handled or when there is
 * nothing to do.
 */
export function applyListOverlay(search: string, actions: PreviewActions, firstLink: Link | null): boolean {
  const { overlay } = read(search);
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
    case 'toast':
      actions.toast('daffa.me/cv copied to clipboard', { sticky: true });
      return true;
    case 'edit':
    case 'qr':
    case 'delete': {
      if (!firstLink) return false;
      const ref = { id: firstLink.id, slug: firstLink.slug, title: firstLink.title };
      if (overlay === 'edit') actions.openEdit(firstLink);
      else if (overlay === 'qr') actions.openQr(ref);
      else actions.openDelete(ref);
      return true;
    }
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

import * as dev from './devPreview';
import type { DetailFlags, FirstRows, ListFlags, ModerationPreviewActions, PreviewActions } from './devPreview';

export type { DetailFlags, FirstRows, ListFlags, ModerationPreviewActions, PreviewActions };

const NO_LIST_FLAGS: ListFlags = {
  loading: false,
  error: false,
  empty: false,
  noResults: false,
  tagOpen: false,
  sortOpen: false,
  menuOpen: false,
  menuBlocked: false,
  loadingMore: false,
  budgetShare: null,
};

const NO_DETAIL_FLAGS: DetailFlags = { loading: false, error: false, empty: false, notFound: false, flat: false };

/**
 * The only way into the dev state preview. In a production build
 * import.meta.env.DEV is the literal false, so each export collapses to its
 * constant branch and devPreview.ts, with every state name in it, is dropped.
 * Pages only ever see booleans, never the preview strings.
 */
export const listFlags: (search: string) => ListFlags = import.meta.env.DEV ? dev.listFlags : () => NO_LIST_FLAGS;

export const detailFlags: (search: string) => DetailFlags = import.meta.env.DEV
  ? dev.detailFlags
  : () => NO_DETAIL_FLAGS;

export const applyListOverlay: typeof dev.applyListOverlay = import.meta.env.DEV
  ? dev.applyListOverlay
  : () => true;

export const applyDetailOverlay: typeof dev.applyDetailOverlay = import.meta.env.DEV
  ? dev.applyDetailOverlay
  : () => true;

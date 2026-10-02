import * as dev from './devPreview';
import type { PublicPreview } from './devPreview';

export type { PublicPreview };

/**
 * The only way into the public page's dev preview. In a production build
 * import.meta.env.DEV is the literal false, so this collapses to a constant
 * null and devPreview.ts, with every state name in it, is dropped.
 */
export const publicPreview: (search: string) => PublicPreview | null = import.meta.env.DEV
  ? (search) => dev.publicPreview(search)
  : () => null;

import FAVICON from '../../dashboard/public/favicon.ico';
import TOUCH_ICON from '../../dashboard/public/apple-touch-icon.png';

/**
 * The icons of daffa.me. Browsers ask for /favicon.ico on their own, and
 * Safari asks for the touch icons on every page it shows, so the visitor
 * pages need no tag for them.
 *
 * The bytes are the files npm run icons writes for the dashboard, imported as
 * Data modules (wrangler.jsonc rules), so both Workers serve one set of files
 * and no copy can drift. Each module loads once per isolate, and the Response
 * constructor copies the buffer, so serving one costs next to no CPU.
 *
 * index.ts routes these paths before the slug guessing guard: they never
 * count as a miss, never touch D1, and stay available to a blocked network.
 */

interface Icon {
  body: ArrayBuffer;
  type: string;
}

export const ICONS: Record<string, Icon> = {
  '/favicon.ico': { body: FAVICON, type: 'image/x-icon' },
  '/apple-touch-icon.png': { body: TOUCH_ICON, type: 'image/png' },
  '/apple-touch-icon-precomposed.png': { body: TOUCH_ICON, type: 'image/png' },
};

/** A week: the icon rarely changes, and browsers keep favicons longer than that anyway. */
export const ICON_CACHE = 'public, max-age=604800';

/** The same response for GET and HEAD. The runtime drops the body of a HEAD answer. */
export function iconResponse(icon: Icon): Response {
  return new Response(icon.body, {
    headers: {
      'Content-Type': icon.type,
      'Content-Length': String(icon.body.byteLength),
      'Cache-Control': ICON_CACHE,
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

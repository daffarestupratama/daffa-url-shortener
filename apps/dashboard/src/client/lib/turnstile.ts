/**
 * The public Turnstile site key. Vite writes VITE_TURNSTILE_SITE_KEY into the
 * turnstile-site-key meta tag of index.html at build time: the test key from
 * .env.development locally, the real key from .env.production in a build. A
 * build time value needs no request before the widget can render, and a
 * development key can never reach production. npm run check:bundle refuses a
 * build that carries a test key or the placeholder.
 */
export function turnstileSiteKey(): string {
  return document.querySelector<HTMLMetaElement>('meta[name="turnstile-site-key"]')?.content ?? '';
}

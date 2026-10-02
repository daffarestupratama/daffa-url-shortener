/**
 * Cloudflare Turnstile on the public page, the only place it is ever loaded.
 * The script is injected on first use, so the dashboard never requests it and
 * the public page only does once the form mounts.
 */

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

/** The options of turnstile.render this page uses. */
export interface TurnstileRenderOptions {
  sitekey: string;
  theme: 'light' | 'dark' | 'auto';
  size: 'normal' | 'compact' | 'flexible';
  'refresh-expired': 'auto' | 'manual' | 'never';
  callback: (token: string) => void;
  'expired-callback': () => void;
  /** Returning true marks the error as handled, so Turnstile does not log it again. */
  'error-callback': (code: string) => boolean;
  'timeout-callback': () => void;
}

/** The part of window.turnstile this page calls. */
export interface TurnstileApi {
  render: (container: HTMLElement, options: TurnstileRenderOptions) => string | undefined;
  reset: (widgetId?: string) => void;
  remove: (widgetId?: string) => void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

/** Explicit rendering, so the widget appears exactly in the slot the design reserves for it. */
const SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

let loading: Promise<TurnstileApi> | null = null;

/** Loads the Turnstile script once. A failed load can be tried again by the next call. */
export function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  loading ??= new Promise<TurnstileApi>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = SCRIPT_URL;
    script.async = true;
    script.onload = () => {
      if (window.turnstile) resolve(window.turnstile);
      else reject(new Error('The Turnstile script loaded without starting.'));
    };
    script.onerror = () => {
      loading = null;
      script.remove();
      reject(new Error('The Turnstile script could not be loaded.'));
    };
    document.head.append(script);
  });
  return loading;
}

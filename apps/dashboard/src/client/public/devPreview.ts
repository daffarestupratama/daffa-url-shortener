/**
 * Development only. Forces a designed state of the public page from the URL,
 * so every state can be compared with Halaman Publik.dc.html:
 *
 *   /?state=filled | submitting | success | invalid | ip | too-long | loop | shortener | blocked
 *          | turnstile | turnstile-pending | turnstile-offline | network | unavailable | static-hero
 *   /?overlay=rate-visitor | rate-global | toast
 *
 * Both parameters combine, such as /?state=success&overlay=toast. While any
 * preview is active the form never calls the API, so a preview never creates
 * a link. Every state name and value lives here, and public/preview.ts only
 * reaches this module behind import.meta.env.DEV, so a production build
 * carries none of it. scripts/check-bundle.mjs verifies that.
 */

import { blockedDomainMessage, checkPublicUrl, nextHourStart, type PublicCreateResult } from '@daffa/shared';
import type { FormForce } from './PublicForm';
import type { RateLimit } from './RateLimitDialog';

/** The same marker as the dashboard preview, which check:bundle looks for. */
export const DEV_PREVIEW_MARKER = 'daffa-dev-state-preview';

export interface PublicPreview {
  form: FormForce | null;
  result: PublicCreateResult | null;
  rate: RateLimit | null;
  /** A sticky toast message. */
  toast: string | null;
  /** The static frame of the chain hero, as prefers-reduced-motion shows it. */
  stillHero: boolean;
  /** False when the state forces the Turnstile slot itself, so no live widget hides it. */
  loadTurnstile: boolean;
}

const DEMO_URL = 'https://docs.google.com/forms/d/e/1FAIpQLSd3kR9vQx/viewform?usp=sf_link';
const DEMO_SLUG = 'x7kq2m';

/** A URL the local check refuses, with the message it gives. */
function refused(url: string): FormForce {
  return { url, fieldError: checkPublicUrl(url)?.message ?? '' };
}

let announced = false;

/** The forced preview for this URL, or null when none is asked for. */
export function publicPreview(search: string, now: number = Date.now()): PublicPreview | null {
  const params = new URLSearchParams(search);
  const state = params.get('state');
  const overlay = params.get('overlay');
  if (!state && !overlay) return null;
  if (!announced) {
    announced = true;
    console.info(`[${DEV_PREVIEW_MARKER}]`, { state, overlay });
  }

  const preview: PublicPreview = { form: null, result: null, rate: null, toast: null, stillHero: false, loadTurnstile: true };

  switch (state) {
    case 'filled':
      preview.form = { url: DEMO_URL };
      break;
    case 'submitting':
      preview.form = { url: DEMO_URL, busy: true };
      break;
    case 'success':
      preview.result = { slug: DEMO_SLUG, shortUrl: `https://daffa.me/${DEMO_SLUG}`, url: DEMO_URL, createdAt: now };
      break;
    case 'invalid':
      preview.form = refused('docs google com/forms/rsvp');
      break;
    case 'ip':
      preview.form = refused('http://192.168.1.10/admin');
      break;
    case 'too-long':
      preview.form = refused(`https://example.com/${'a'.repeat(2100)}`);
      break;
    case 'loop':
      preview.form = refused('https://daffa.me/cv');
      break;
    case 'shortener':
      preview.form = refused('https://bit.ly/3xYz9Qa');
      break;
    case 'blocked':
      // The blocked list lives on the server, so this message comes from the shared copy.
      preview.form = {
        url: 'https://login-verif-bca.site/akun/verifikasi',
        fieldError: blockedDomainMessage('login-verif-bca.site'),
      };
      break;
    case 'turnstile':
      preview.form = { url: DEMO_URL, turnstileError: 'failed' };
      preview.loadTurnstile = false;
      break;
    case 'turnstile-pending':
      preview.form = { url: DEMO_URL, turnstileError: 'pending' };
      preview.loadTurnstile = false;
      break;
    case 'turnstile-offline':
      preview.form = { url: DEMO_URL, turnstileError: 'offline' };
      preview.loadTurnstile = false;
      break;
    case 'network':
    case 'unavailable':
      // A dropped connection and turnstile_unavailable share the retry panel.
      preview.form = { url: DEMO_URL, retry: true };
      break;
    case 'static-hero':
      preview.stillHero = true;
      break;
    default:
      break;
  }

  switch (overlay) {
    case 'rate-visitor':
      preview.rate = { scope: 'visitor', resetAt: nextHourStart(now) };
      break;
    case 'rate-global':
      preview.rate = { scope: 'global', resetAt: nextHourStart(now) };
      break;
    case 'toast':
      preview.toast = `daffa.me/${DEMO_SLUG} copied to clipboard`;
      break;
    default:
      break;
  }
  return preview;
}

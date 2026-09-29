import type { MiddlewareHandler } from 'hono';
import { isDevBypass } from './auth';
import type { AppEnv } from './env';
import { ApiError } from './errors';

/** Hardcoded on purpose. Production never derives the allowed origin from the request. */
export const PRODUCTION_ORIGIN = 'https://shorten.daffa.me';

const STATE_CHANGING: readonly string[] = ['POST', 'PUT', 'PATCH', 'DELETE'];

/**
 * In production only the dashboard origin itself. With the development bypass
 * active, the origin the request was sent to, so http://localhost:5173 works
 * while another local app on a different port is still refused.
 */
export function allowedOrigin(url: URL, devBypass: boolean): string {
  return devBypass ? url.origin : PRODUCTION_ORIGIN;
}

/** Compares the media type only, so "application/json; charset=utf-8" passes. */
export function isJsonContentType(value: string | undefined): boolean {
  if (!value) return false;
  const mediaType = value.split(';')[0] ?? '';
  return mediaType.trim().toLowerCase() === 'application/json';
}

/**
 * Every state changing request must come from the dashboard page and declare a
 * JSON body. A cross site form can do neither: browsers always send Origin on
 * these methods, and a form cannot set Content-Type to application/json. This
 * applies to DELETE and to POST routes without a body as well.
 */
export const csrfMiddleware: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (!STATE_CHANGING.includes(c.req.method)) {
    return next();
  }
  const url = new URL(c.req.url);
  const expected = allowedOrigin(url, isDevBypass(c.env, url));
  const origin = c.req.header('origin');
  if (origin !== expected || !isJsonContentType(c.req.header('content-type'))) {
    throw new ApiError('csrf_rejected');
  }
  return next();
};

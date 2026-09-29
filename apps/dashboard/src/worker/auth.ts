import type { MiddlewareHandler } from 'hono';
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import type { AppEnv, Env } from './env';
import { ApiError } from './errors';

/** The header Cloudflare Access sets on every request it lets through. */
export const ACCESS_HEADER = 'cf-access-jwt-assertion';

/** The identity used while the local development bypass is active. */
export const DEV_EMAIL = 'developer@localhost';

const LOCAL_HOSTNAMES: readonly string[] = ['localhost', '127.0.0.1'];

export function isLocalHostname(hostname: string): boolean {
  return LOCAL_HOSTNAMES.includes(hostname);
}

/**
 * True only when both conditions hold: the flag is exactly "true", and the
 * request was addressed to localhost or 127.0.0.1. In production the hostname
 * is always shorten.daffa.me, so a stray flag can never open the dashboard.
 */
export function isDevBypass(env: Pick<Env, 'DEV_AUTH_BYPASS'>, url: URL): boolean {
  return env.DEV_AUTH_BYPASS === 'true' && isLocalHostname(url.hostname);
}

/** Accepts "team.cloudflareaccess.com", with or without a scheme or trailing slash. */
export function normalizeTeamDomain(value: string): string {
  return value
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/+$/, '');
}

export interface VerifyOptions {
  getKey: JWTVerifyGetKey;
  issuer: string;
  audience: string;
}

/**
 * Verifies an Access token: RS256 signature against the team keys, issuer,
 * audience and expiry. `email` is required because this dashboard is personal
 * and Access service tokens, which carry no email, are not a supported caller.
 */
export async function verifyAccessToken(
  token: string,
  { getKey, issuer, audience }: VerifyOptions,
): Promise<{ email: string }> {
  const { payload } = await jwtVerify(token, getKey, {
    issuer,
    audience,
    algorithms: ['RS256'],
    requiredClaims: ['exp', 'email'],
  });
  if (typeof payload.email !== 'string' || payload.email === '') {
    throw new Error('The Access token carries no email address.');
  }
  return { email: payload.email };
}

const keySets = new Map<string, JWTVerifyGetKey>();

/**
 * The team signing keys, fetched from Access and cached for the life of the
 * isolate. jose refetches when it meets an unknown key id, which covers key
 * rotation, and the cooldown stops a burst of bad tokens from hammering Access.
 */
export function accessKeySet(teamDomain: string): JWTVerifyGetKey {
  let keySet = keySets.get(teamDomain);
  if (!keySet) {
    keySet = createRemoteJWKSet(new URL(`https://${teamDomain}/cdn-cgi/access/certs`), {
      cacheMaxAge: 10 * 60 * 1000,
      cooldownDuration: 30 * 1000,
    });
    keySets.set(teamDomain, keySet);
  }
  return keySet;
}

export interface AuthOptions {
  /** Injectable so tests can use a local key set and observe whether it is reached. */
  getKeySet?: (teamDomain: string) => JWTVerifyGetKey;
}

/**
 * Checks run in a fixed order and stop at the first failure:
 *   1. development bypass active, continue as DEV_EMAIL
 *   2. Access settings missing, 500 auth_not_configured
 *   3. no token header, 403 forbidden, before any key lookup
 *   4. token fails verification, 403 forbidden
 */
export function createAuthMiddleware({
  getKeySet = accessKeySet,
}: AuthOptions = {}): MiddlewareHandler<AppEnv> {
  let warnedAboutFlag = false;

  return async (c, next) => {
    const url = new URL(c.req.url);

    if (isDevBypass(c.env, url)) {
      c.set('email', DEV_EMAIL);
      return next();
    }

    if (c.env.DEV_AUTH_BYPASS === 'true' && !warnedAboutFlag) {
      warnedAboutFlag = true;
      console.warn(`DEV_AUTH_BYPASS is set but ${url.hostname} is not local. The flag is ignored.`);
    }

    const teamDomain = normalizeTeamDomain(c.env.ACCESS_TEAM_DOMAIN ?? '');
    const audience = (c.env.ACCESS_AUD ?? '').trim();
    if (!teamDomain || !audience) {
      console.error('ACCESS_TEAM_DOMAIN or ACCESS_AUD is not set.');
      throw new ApiError('auth_not_configured');
    }

    const token = c.req.header(ACCESS_HEADER);
    if (!token) {
      throw new ApiError('forbidden');
    }

    try {
      const { email } = await verifyAccessToken(token, {
        getKey: getKeySet(teamDomain),
        issuer: `https://${teamDomain}`,
        audience,
      });
      c.set('email', email);
    } catch (error) {
      // The reason stays in the log. The caller only learns that access was refused.
      console.error('Access token rejected', error instanceof Error ? error.message : error);
      throw new ApiError('forbidden');
    }

    return next();
  };
}

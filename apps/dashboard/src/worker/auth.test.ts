import { Hono } from 'hono';
import {
  SignJWT,
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  type CryptoKey,
  type JWTVerifyGetKey,
} from 'jose';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import {
  ACCESS_HEADER,
  DEV_EMAIL,
  accessKeySet,
  createAuthMiddleware,
  isDevBypass,
  normalizeTeamDomain,
  verifyAccessToken,
} from './auth';
import type { AppEnv, Env } from './env';
import { handleError } from './errors';

const TEAM = 'daffa.cloudflareaccess.com';
const ISSUER = `https://${TEAM}`;
const AUDIENCE = 'aud-tag-for-tests';
const KID = 'test-key-1';
const EMAIL = 'daffarestupratama@gmail.com';

let signingKey: CryptoKey;
let foreignKey: CryptoKey;
let keySet: JWTVerifyGetKey;

beforeAll(async () => {
  const pair = await generateKeyPair('RS256', { extractable: true });
  const publicJwk = await exportJWK(pair.publicKey);
  keySet = createLocalJWKSet({ keys: [{ ...publicJwk, kid: KID, alg: 'RS256', use: 'sig' }] });
  signingKey = pair.privateKey;
  // A second key that claims the same kid, to prove the signature itself is checked.
  foreignKey = (await generateKeyPair('RS256')).privateKey;
});

interface TokenOptions {
  issuer?: string;
  audience?: string;
  expiresAt?: number | string;
  email?: string | null;
  key?: CryptoKey;
}

function signToken({
  issuer = ISSUER,
  audience = AUDIENCE,
  expiresAt = '5m',
  email = EMAIL,
  key,
}: TokenOptions = {}): Promise<string> {
  const payload = email === null ? {} : { email };
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'RS256', kid: KID })
    .setIssuedAt()
    .setIssuer(issuer)
    .setAudience(audience)
    .setExpirationTime(expiresAt)
    .sign(key ?? signingKey);
}

const verify = (token: string) =>
  verifyAccessToken(token, { getKey: keySet, issuer: ISSUER, audience: AUDIENCE });

describe('verifyAccessToken', () => {
  it('accepts a valid token and returns its email', async () => {
    await expect(verify(await signToken())).resolves.toEqual({ email: EMAIL });
  });

  it('rejects a token for another audience', async () => {
    await expect(verify(await signToken({ audience: 'someone-else' }))).rejects.toThrow(/aud/);
  });

  it('rejects a token from another issuer', async () => {
    await expect(
      verify(await signToken({ issuer: 'https://attacker.cloudflareaccess.com' })),
    ).rejects.toThrow(/iss/);
  });

  it('rejects an expired token', async () => {
    const anHourAgo = Math.floor(Date.now() / 1000) - 3600;
    await expect(verify(await signToken({ expiresAt: anHourAgo }))).rejects.toThrow(/exp/);
  });

  it('rejects a token signed by a different key under the same kid', async () => {
    await expect(verify(await signToken({ key: foreignKey }))).rejects.toThrow(/signature/i);
  });

  it('rejects a token without an email claim', async () => {
    await expect(verify(await signToken({ email: null }))).rejects.toThrow(/email/);
  });

  it('rejects an empty or malformed token', async () => {
    await expect(verify('')).rejects.toThrow();
    await expect(verify('not.a.jwt')).rejects.toThrow();
  });

  it('rejects an HS256 token even with a matching kid', async () => {
    const token = await new SignJWT({ email: EMAIL })
      .setProtectedHeader({ alg: 'HS256', kid: KID })
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setExpirationTime('5m')
      .sign(new TextEncoder().encode('a-shared-secret-an-attacker-might-guess'));
    await expect(verify(token)).rejects.toThrow(/alg/);
  });
});

describe('accessKeySet', () => {
  it('builds one key set per team domain and reuses it', () => {
    const first = accessKeySet('one.cloudflareaccess.com');
    expect(accessKeySet('one.cloudflareaccess.com')).toBe(first);
    expect(accessKeySet('two.cloudflareaccess.com')).not.toBe(first);
  });
});

describe('normalizeTeamDomain', () => {
  it('strips a scheme and trailing slashes', () => {
    expect(normalizeTeamDomain('https://daffa.cloudflareaccess.com/')).toBe(TEAM);
    expect(normalizeTeamDomain('  daffa.cloudflareaccess.com ')).toBe(TEAM);
  });
});

describe('isDevBypass', () => {
  const at = (host: string) => new URL(`http://${host}/api/admin/me`);

  it('is on for localhost and 127.0.0.1 when the flag is exactly "true"', () => {
    expect(isDevBypass({ DEV_AUTH_BYPASS: 'true' }, at('localhost:5173'))).toBe(true);
    expect(isDevBypass({ DEV_AUTH_BYPASS: 'true' }, at('127.0.0.1:5173'))).toBe(true);
  });

  it('is off on the production host even with the flag set', () => {
    expect(isDevBypass({ DEV_AUTH_BYPASS: 'true' }, new URL('https://link.daffa.me/api/admin/me'))).toBe(
      false,
    );
  });

  it('is off for any value other than exactly "true"', () => {
    for (const value of ['TRUE', 'True', '1', 'yes', 'false', '', undefined]) {
      expect(isDevBypass({ DEV_AUTH_BYPASS: value }, at('localhost:5173')), String(value)).toBe(false);
    }
  });

  it('does not treat lookalike hosts as local', () => {
    expect(isDevBypass({ DEV_AUTH_BYPASS: 'true' }, at('localhost.attacker.example'))).toBe(false);
    expect(isDevBypass({ DEV_AUTH_BYPASS: 'true' }, at('127.0.0.1.nip.io'))).toBe(false);
  });
});

describe('authMiddleware, one case per step of the check order', () => {
  const DEV_URL = 'http://localhost:5173/api/admin/me';
  const PROD_URL = 'https://link.daffa.me/api/admin/me';
  const configured: Partial<Env> = { ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUDIENCE };

  function build() {
    const getKeySet = vi.fn((_teamDomain: string) => keySet);
    const app = new Hono<AppEnv>();
    app.onError(handleError);
    app.use('*', createAuthMiddleware({ getKeySet }));
    app.get('/api/admin/me', (c) => c.json({ email: c.get('email') }));
    return { app, getKeySet };
  }

  const env = (overrides: Partial<Env>): Env => ({ DB: {} as D1Database, ...overrides });

  it('step 1: the dev bypass lets a local request through as the dev user', async () => {
    const { app, getKeySet } = build();
    const response = await app.request(DEV_URL, {}, env({ DEV_AUTH_BYPASS: 'true' }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ email: DEV_EMAIL });
    expect(getKeySet).not.toHaveBeenCalled();
  });

  it('step 2: missing Access settings fail closed with 500 auth_not_configured', async () => {
    const { app } = build();
    for (const partial of [{}, { ACCESS_TEAM_DOMAIN: TEAM }, { ACCESS_AUD: AUDIENCE }]) {
      const response = await app.request(PROD_URL, {}, env(partial));
      expect(response.status).toBe(500);
      expect(await response.json()).toMatchObject({ error: { code: 'auth_not_configured' } });
    }
  });

  it('step 3: a missing token is refused with 403 before any key lookup', async () => {
    const { app, getKeySet } = build();
    const response = await app.request(PROD_URL, {}, env(configured));
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: 'forbidden' } });
    expect(getKeySet).not.toHaveBeenCalled();
  });

  it('step 4: an invalid token is refused with 403', async () => {
    const { app, getKeySet } = build();
    const token = await signToken({ audience: 'someone-else' });
    const response = await app.request(PROD_URL, { headers: { [ACCESS_HEADER]: token } }, env(configured));
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: 'forbidden' } });
    expect(getKeySet).toHaveBeenCalledWith(TEAM);
  });

  it('a valid token passes and exposes the email', async () => {
    const { app } = build();
    const token = await signToken();
    const response = await app.request(PROD_URL, { headers: { [ACCESS_HEADER]: token } }, env(configured));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ email: EMAIL });
  });

  it('ignores the bypass flag on the production host', async () => {
    const { app } = build();
    const response = await app.request(
      PROD_URL,
      {},
      env({ ...configured, DEV_AUTH_BYPASS: 'true' }),
    );
    expect(response.status).toBe(403);
  });
});

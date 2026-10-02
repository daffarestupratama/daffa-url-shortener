/**
 * Server side Turnstile check for public link creation. The token from the
 * widget is single use and proves nothing until siteverify confirms it, and
 * the hostname in the answer proves it was solved on this site.
 */

export const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/** The only hostname a production token may come from. */
export const PRODUCTION_HOSTNAME = 'link.daffa.me';

/**
 * What the Cloudflare test secret keys report as hostname for the dummy token
 * XXXX.DUMMY.TOKEN.XXXX. Observed on 2 Oct 2026 with the always pass secret.
 * The documentation example shows localhost, the service answers example.com.
 * Only accepted while the local development bypass is active.
 */
export const TEST_SECRET_HOSTNAME = 'example.com';

/** Cloudflare documents tokens of up to 2048 characters. */
export const MAX_TOKEN_LENGTH = 2048;

const TIMEOUT_MS = 5000;

export type TurnstileOutcome = 'ok' | 'failed' | 'unavailable';

export function acceptedHostnames(devBypass: boolean): readonly string[] {
  return devBypass ? ['localhost', TEST_SECRET_HOSTNAME] : [PRODUCTION_HOSTNAME];
}

export interface VerifyTurnstileOptions {
  secret: string;
  token: string;
  /** CF-Connecting-IP, passed on so Cloudflare can compare it with the solver. */
  remoteIp?: string | null;
  devBypass: boolean;
  /** Injectable for tests. */
  fetcher?: typeof fetch;
}

interface SiteverifyAnswer {
  success?: unknown;
  hostname?: unknown;
  'error-codes'?: unknown;
}

/**
 * 'ok' only for a successful answer from an accepted hostname. A clear
 * rejection is 'failed'. Anything that leaves the answer unknown, such as a
 * network error, a timeout, a non 2xx status, or unreadable JSON, is
 * 'unavailable'. Both of the latter refuse the request, so it fails closed.
 */
export async function verifyTurnstile({
  secret,
  token,
  remoteIp,
  devBypass,
  fetcher = fetch,
}: VerifyTurnstileOptions): Promise<TurnstileOutcome> {
  const body = new URLSearchParams({ secret, response: token });
  if (remoteIp) body.set('remoteip', remoteIp);

  let response: Response;
  try {
    response = await fetcher(SITEVERIFY_URL, {
      method: 'POST',
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    console.error('Turnstile siteverify unreachable', error instanceof Error ? error.message : error);
    return 'unavailable';
  }
  if (!response.ok) {
    console.error(`Turnstile siteverify answered ${response.status}`);
    return 'unavailable';
  }

  let answer: SiteverifyAnswer;
  try {
    answer = (await response.json()) as SiteverifyAnswer;
  } catch {
    console.error('Turnstile siteverify sent a body that is not JSON');
    return 'unavailable';
  }

  if (answer.success !== true) {
    console.warn('Turnstile token rejected', answer['error-codes']);
    return 'failed';
  }
  if (typeof answer.hostname !== 'string' || !acceptedHostnames(devBypass).includes(answer.hostname)) {
    console.warn('Turnstile token solved on another hostname', answer.hostname);
    return 'failed';
  }
  return 'ok';
}

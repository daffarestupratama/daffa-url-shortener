/**
 * Who a request is counted as, for every per visitor limit in both Workers:
 * the hourly public creation limit of the dashboard and the slug guessing
 * guard of the redirector. Neither ever stores or sends on the raw address.
 * Each turns the subject into an HMAC with its own secret first.
 */

const IPV4_MAPPED = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/;
const HEX_GROUP = /^[0-9a-f]{1,4}$/;

/** The eight groups of an IPv6 address, or null when it does not parse. */
function ipv6Groups(address: string): string[] | null {
  const halves = address.split('::');
  if (halves.length > 2) return null;
  const split = (part: string | undefined) => (part ? part.split(':') : []);
  // An embedded IPv4 tail such as 64:ff9b::192.0.2.1 fills the last two groups.
  const expandTail = (parts: string[]) =>
    parts.flatMap((part) => (part.includes('.') ? ['0', '0'] : [part]));
  const head = expandTail(split(halves[0]));
  const tail = expandTail(split(halves[1]));
  let groups: string[];
  if (halves.length === 1) {
    groups = head;
  } else {
    const fill = 8 - head.length - tail.length;
    if (fill < 1) return null;
    groups = [...head, ...Array<string>(fill).fill('0'), ...tail];
  }
  if (groups.length !== 8 || !groups.every((group) => HEX_GROUP.test(group))) return null;
  return groups.map((group) => parseInt(group, 16).toString(16));
}

/**
 * What a visitor is counted as. IPv4 addresses count one by one. IPv6
 * addresses count per /64, the block a single subscriber usually receives, so
 * hopping between addresses inside it does not reset a limit. A missing
 * header, which only happens outside Cloudflare, falls into one shared subject.
 */
export function rateLimitSubject(ip: string | null | undefined): string {
  const value = (ip ?? '').trim().toLowerCase().split('%')[0] ?? '';
  if (!value) return 'unknown';
  const mapped = IPV4_MAPPED.exec(value);
  if (mapped?.[1]) return mapped[1];
  if (!value.includes(':')) return value;
  const groups = ipv6Groups(value);
  return groups ? `${groups.slice(0, 4).join(':')}::/64` : value;
}

const encoder = new TextEncoder();
const keys = new Map<string, Promise<CryptoKey>>();

/** Imported once per secret and isolate, so a request only pays for the signature. */
function hmacKey(secret: string): Promise<CryptoKey> {
  let key = keys.get(secret);
  if (!key) {
    key = crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
      'sign',
    ]);
    keys.set(secret, key);
  }
  return key;
}

function base64Url(bytes: ArrayBuffer): string {
  let binary = '';
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * HMAC-SHA-256 of `message`, base64url without padding (43 characters). The
 * secret keeps the value from being reversed by hashing every IPv4 address.
 */
export async function hmacTag(secret: string, message: string): Promise<string> {
  return base64Url(await crypto.subtle.sign('HMAC', await hmacKey(secret), encoder.encode(message)));
}

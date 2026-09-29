/**
 * Slug rules, ported from the design prototype. Two to 80 characters of
 * lowercase letters, digits and hyphens, and never starting with a hyphen.
 */
export const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,79}$/;

export const SLUG_MIN_LENGTH = 2;
export const SLUG_MAX_LENGTH = 80;

/** Paths the application needs for itself, so they can never become slugs. */
export const RESERVED: readonly string[] = [
  'api',
  'admin',
  'dashboard',
  'shorten',
  'www',
  'static',
  'assets',
  'login',
  'logout',
  'health',
  'qr',
  'favicon',
  'robots',
];

/** Ambiguous characters are left out: no lowercase L, no O, no zero, no one. */
const GENERATE_ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789';
const GENERATE_LENGTH = 6;

export interface SlugOwner {
  slug: string;
  title: string;
}

export interface ValidateSlugOptions {
  /** Report an empty slug as an error. The form only does this after a save attempt. */
  required?: boolean;
  /** Slugs already in use by another link, used for the conflict message. */
  taken?: readonly SlugOwner[];
}

/**
 * Returns an error message, or null when the slug is acceptable. The order of
 * the checks and the wording of each message match the design.
 */
export function validateSlug(slug: string, options: ValidateSlugOptions = {}): string | null {
  if (!slug) {
    return options.required ? 'Slug is required. Press Generate to fill in a random slug.' : null;
  }
  if (slug.startsWith('-')) {
    return 'Slug cannot start with a hyphen.';
  }
  if (/[A-Z]/.test(slug)) {
    return 'Slug must be lowercase. Replace uppercase letters with lowercase.';
  }
  if (/[^a-z0-9-]/.test(slug)) {
    return 'Slug may only contain lowercase letters, numbers, and hyphens.';
  }
  if (slug.length < SLUG_MIN_LENGTH) {
    return 'Slug must be at least 2 characters.';
  }
  if (slug.length > SLUG_MAX_LENGTH) {
    return 'Slug must be 80 characters or fewer.';
  }
  if (RESERVED.includes(slug)) {
    return `"${slug}" is a reserved word and cannot be used.`;
  }
  const owner = options.taken?.find((candidate) => candidate.slug === slug);
  if (owner) {
    return `This slug is already used by "${owner.title}".`;
  }
  return null;
}

/** True when the value can be looked up as a slug. Used on the redirect path. */
export function isValidSlugPath(value: string): boolean {
  return SLUG_RE.test(value);
}

/**
 * Turns a request pathname into a slug candidate: drop the leading slash,
 * lowercase it, then drop one trailing slash. So "/CV/" becomes "cv".
 */
export function normalizeSlugPath(pathname: string): string {
  let value = pathname.toLowerCase();
  if (value.startsWith('/')) value = value.slice(1);
  if (value.endsWith('/')) value = value.slice(0, -1);
  return value;
}

/**
 * Six random characters from the unambiguous alphabet, retried until unused.
 * `isTaken` lets the caller check against storage.
 */
export function generateSlug(
  isTaken: (slug: string) => boolean = () => false,
  maxAttempts = 100,
): string {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    let candidate = '';
    for (let i = 0; i < GENERATE_LENGTH; i += 1) {
      candidate += GENERATE_ALPHABET.charAt(Math.floor(Math.random() * GENERATE_ALPHABET.length));
    }
    if (!RESERVED.includes(candidate) && !isTaken(candidate)) return candidate;
  }
  throw new Error('Unable to generate an unused slug.');
}

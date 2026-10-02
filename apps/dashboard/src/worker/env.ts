export interface Env {
  DB: D1Database;
  /** For example daffa.cloudflareaccess.com. Set as a secret in production. */
  ACCESS_TEAM_DOMAIN?: string;
  /** The Access application audience tag. Set as a secret in production. */
  ACCESS_AUD?: string;
  /** "true" in .dev.vars skips Access, and only ever on localhost. */
  DEV_AUTH_BYPASS?: string;
  /** Turnstile secret key for public link creation. Set as a secret in production. */
  TURNSTILE_SECRET?: string;
  /** HMAC key for the per visitor rate limit buckets, so no raw IP is stored. Set as a secret. */
  RATE_LIMIT_SECRET?: string;
}

export interface Variables {
  /** Email of the signed in user, from the verified Access token. */
  email: string;
}

export interface AppEnv {
  Bindings: Env;
  Variables: Variables;
}

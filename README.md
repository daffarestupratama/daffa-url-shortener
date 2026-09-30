# daffa-url-shortener

Personal URL shortener with click analytics. Short links resolve at `daffa.me/{slug}`, and a private dashboard at `shorten.daffa.me` manages links and presents visitor analytics. The whole system runs on the Cloudflare free plan.

## Use case

The project replaces an earlier shortener built on Strapi at `s.daffa.me`. Links are created by hand from the dashboard, and every visit is recorded with location, network, device, and referrer data. The dashboard shows analytics per link, keeps link preview bots separate from human visits, and generates a static QR code for every link. Old `s.daffa.me` links remain valid through a permanent redirect to `daffa.me`.

## Architecture

One repository holds two Cloudflare Workers that share one D1 database.

| Worker | Hostname | Role |
|---|---|---|
| `daffa-redirector` | `daffa.me` | Looks up the slug, redirects, logs the click, and serves the 404, 410, and 503 visitor pages |
| `daffa-dashboard` | `shorten.daffa.me` | Hono JSON API under `/api` plus a React single page application served as static assets |

The split isolates the public redirect path. A faulty dashboard deploy cannot break published links, and the SPA fallback of the dashboard never intercepts slugs. The root `daffa.me` without a slug redirects to `daffarestupratama.com`.

### Redirect flow

1. The path is lowercased and stripped of a trailing slash. Any path that fails the slug pattern receives a 404 without a database query.
2. One indexed D1 lookup finds the link.
3. An active link receives a 302 with a `no-store, private` Cache-Control header, so browsers never cache the redirect and every visit stays countable.
4. Click logging runs in `ctx.waitUntil` after the response, so logging never delays the redirect. HEAD requests are not logged.
5. Inactive or expired links receive 410, unknown slugs receive 404, and database failures receive 503.

Incoming query strings are ignored. The redirect always points to the stored destination exactly as saved.

### Recorded click data

Timestamp, full IP address from `CF-Connecting-IP`, raw User-Agent, bot flag, country, region, city, timezone, Cloudflare data center (IATA colo code), ASN, AS organization, and referrer. Location and network fields come from `request.cf` at no CPU cost. Raw IP addresses are kept indefinitely and are deleted manually through the D1 console when needed.

### Performance rules

- The free plan allows 10 ms of CPU per request. The redirect path never parses User-Agents and detects bots with a single regular expression test.
- User-Agent parsing, charts, and QR generation run in the browser. The API returns grouped raw data.
- Aggregations run in SQL against two indexes on `clicks`. `npm run explain` confirms that no query scans the full `clicks` table.
- Visitor pages are single HTML documents with inline CSS, no JavaScript, no web fonts, and a hard limit of 3 KB.

### Security

- Cloudflare Access protects the entire dashboard hostname. Login uses Google, and the Access policy allows a single email address. The Google OAuth app stays in Testing mode with the owner account as the only test user.
- The API verifies the Access JWT from `Cf-Access-Jwt-Assertion` with `jose` against the team JWKS, checking signature (RS256 only), audience, issuer, and expiry. Missing configuration fails closed with a 500.
- Every POST, PATCH, and DELETE request requires the dashboard origin and a JSON content type as CSRF protection.
- The `workers.dev` route and preview URLs of the dashboard are disabled, so Access cannot be bypassed.
- `apps/dashboard/public/_headers` sets `X-Frame-Options DENY`, `frame-ancestors 'none'`, `nosniff`, and a strict referrer policy on static assets.
- A local auth bypass exists only when `DEV_AUTH_BYPASS=true` is set in `.dev.vars` and the request host is `localhost` or `127.0.0.1`.

## Tech stack

| Area | Choice |
|---|---|
| Runtime | Cloudflare Workers, free plan |
| Database | Cloudflare D1 (SQLite), APAC location |
| Server | Hono |
| Authentication | Cloudflare Access with Google, verified with `jose` |
| Frontend | React 19, Vite 8, `@cloudflare/vite-plugin` |
| Styling | CSS modules with CSS variable tokens, neumorphism with airport wayfinding accents, light mode |
| Fonts | Atkinson Hyperlegible Next and Mono, self hosted through Fontsource |
| Flags and QR | `country-flag-icons` SVG files, `qrcode-generator` loaded on demand |
| Testing | Vitest, plus smoke, bundle, copy, and query plan scripts |
| Tooling | TypeScript, npm workspaces, Wrangler 4, concurrently |

The client router and the User-Agent parser are hand written to keep the bundle small and free of AGPL code.

## Project structure

```
.
├── apps/
│   ├── redirector/          Worker for daffa.me
│   │   ├── src/index.ts     routes and redirect logic
│   │   ├── src/log.ts       click insert inside waitUntil
│   │   ├── src/pages.ts     404, 410, and 503 visitor pages
│   │   └── wrangler.jsonc
│   └── dashboard/           Worker for shorten.daffa.me
│       ├── src/worker/      Hono API, Access auth, CSRF, validation, SQL queries
│       ├── src/client/      React app (components, features, lib, styles)
│       ├── public/          _headers and favicons, copied as is into the build
│       ├── index.html
│       ├── vite.config.ts
│       ├── wrangler.jsonc
│       └── .dev.vars.example
├── shared/                  code used by both Workers and the client
│                            (slug rules, URL validation, tags, status, bot regex,
│                            design tokens, WIB time helpers, API types, tests)
├── migrations/              D1 schema (0001_init.sql)
├── scripts/                 Node scripts for seeding, audits, smoke tests, icons
├── design/                  Claude Design handoff bundle, read only reference
├── package.json             workspaces and all npm scripts
├── tsconfig.json
└── vitest.config.ts
```

## Data model

| Table | Content |
|---|---|
| `links` | slug (unique), destination URL, title, description, active flag, expiry, timestamps |
| `tags` and `link_tags` | tag names and the many to many relation |
| `clicks` | one row per visit with the fields listed above |

Indexes `idx_clicks_link_ts (link_id, ts)` and `idx_clicks_link_bot_ts (link_id, is_bot, ts)` serve every analytics query. Link status is never stored. Status is derived from the active flag and the expiry date. Deleting a link cascades to the clicks and tag relations of that link. All timestamps are epoch milliseconds, and the dashboard displays every timestamp in WIB (UTC+7).

## Link rules

- Slug pattern `^[a-z0-9][a-z0-9-]{1,79}$`, which allows 2 to 80 lowercase characters and forbids a leading hyphen. The pattern matches the legacy shortener, so all old slugs remain valid.
- Reserved slugs are `api admin dashboard shorten www static assets login logout health qr favicon robots`.
- Generated slugs use 6 characters from `abcdefghijkmnpqrstuvwxyz23456789`, which excludes look alike characters.
- Destinations must use http or https and a dotted hostname. `daffa.me` and `www.daffa.me` are rejected to prevent redirect loops. Other `daffa.me` subdomains are allowed.
- Reactivating an expired link clears the expiry date.
- QR codes encode `https://daffa.me/{slug}`, not the destination, so printed codes survive destination changes.

## Analytics definitions

- A unique visitor is a distinct combination of IP address and User-Agent.
- Human and bot clicks are counted separately. Rankings and network panels use human clicks only.
- Ranges are 24h (hourly buckets), 7d, 30d, and 90d (daily buckets in WIB), and all (monthly buckets).
- The chart marks a peak only when at least three buckets hold clicks and the peak reaches three times the median.
- Numbers use the `1.234` format and dates use the `27 Sep 2026` format.

## API

```
GET    /api/me
GET    /api/summary
GET    /api/links?q&tag&status&sort          sort is newest, oldest, clicks, or least
POST   /api/links
GET    /api/links/{id}
PATCH  /api/links/{id}
DELETE /api/links/{id}
POST   /api/links/{id}/toggle
GET    /api/slugs/{slug}/available?exclude={id}
GET    /api/tags
GET    /api/links/{id}/analytics?range=24h|7d|30d|90d|all
GET    /api/links/{id}/clicks?range&page
```

Errors always follow the shape `{ "error": { "code", "message" } }`.

## Commands

| Command | Purpose |
|---|---|
| `npm run dev` | Runs both Workers locally (dashboard on port 5173, redirector on port 8787) |
| `npm run dev:redirect` and `npm run dev:dashboard` | Runs one Worker only |
| `npm run migrate:local` | Applies migrations to the local database |
| `npm run seed:local` | Wipes the local database and loads sample links and clicks |
| `npm run check` | Typecheck, unit tests, visitor page size, copy audit, and token audit |
| `npm test` | Unit tests only |
| `npm run build:dashboard` | Builds the dashboard |
| `npm run check:bundle` | Checks the dashboard build for dev only code, CDN URLs, headers, favicons, and bundle size |
| `npm run explain` | Prints the query plan of every SQL statement and fails on a full scan of `clicks` |
| `npm run smoke` | End to end API test against a running `npm run dev` |
| `npm run db:counts` | Prints row counts of the local database |
| `npm run icons` | Regenerates the favicons from the design tokens |
| `npm run migrate:remote` | Applies migrations to the production database |
| `npm run deploy:redirect` | Deploys the redirector |
| `npm run deploy:dashboard` | Builds and deploys the dashboard |

## Local development

1. Install dependencies with `npm install`.
2. Copy `apps/dashboard/.dev.vars.example` to `apps/dashboard/.dev.vars` and keep `DEV_AUTH_BYPASS=true`. The file is ignored by git.
3. Run `npm run migrate:local` and `npm run seed:local`.
4. Run `npm run dev`, then open `http://localhost:5173` for the dashboard and `http://127.0.0.1:8787/{slug}` for redirects.

Notes for local work

- Both Workers share one local database in `.wrangler-state`. The file name derives from the D1 `database_id`, so a changed id starts an empty local database that needs migrate and seed again.
- The seed script deletes all local data first. Seed links keep stable ids (for example `/links/1` is `cv` and `/links/9` has no clicks).
- In development only, `?state=loading|error|empty|noresults|notfound|flat` and `?overlay=create|edit|qr|delete|toast` force any designed state for visual checks. Both parameters are removed from production builds.
- Local data never touches production.

## Deployment

The standard workflow is change locally, verify with `npm run check`, commit, then deploy the affected Worker with `npm run deploy:redirect` or `npm run deploy:dashboard`.

- Run `npm run migrate:remote` only when a new file appears in `migrations/`. Code or style changes never need a migration.
- Wrangler commands for the dashboard must run inside the dashboard workspace, because the Vite plugin writes a redirected Wrangler config there during the build. Secrets are set with `npm exec -w @daffa/dashboard -- wrangler secret put NAME`.
- The dashboard needs two production secrets. `ACCESS_TEAM_DOMAIN` holds the Zero Trust team domain without the scheme, and `ACCESS_AUD` holds the Application Audience tag of the Access application.
- If a fresh dashboard deploy serves a blank or broken page, deploying again without changes resolves a known intermittent Vite plugin issue.

### Cloudflare configuration outside the repository

| Item | Setting |
|---|---|
| D1 | Database `daffa-links`, APAC location |
| Zero Trust | Google identity provider, Access application `Link Manager` on `shorten.daffa.me`, allow policy for one email, Google as the only login method with instant authentication, one month session |
| Redirect Rule | `www.daffa.me` to `daffa.me` with the path kept, status 301 |
| Redirect Rule | `s.daffa.me/*` to `daffa.me/${1}`, status 301, query string dropped |
| DNS | `daffa.me` and `shorten.daffa.me` are Worker custom domains. `www` is a proxied dummy record (192.0.2.1). `s` still points to the legacy VM, proxied, until cleanup |

## Monitoring

- Workers and Pages, `daffa-redirector`, Metrics tab. The Exceeded CPU Time Limits count should stay at zero, and CPU P99 should stay under 10 ms.
- D1, `daffa-links`, Overview tab. Rows read and rows written should stay far below the free plan limits.
- Most redirector traffic from unfamiliar regions comes from automated scanners and link preview crawlers. Invalid paths are answered without a database query.

## Maintenance notes

- The worst case 404 visitor page sits about 50 bytes below the 3 KB limit. Any new content on visitor pages requires savings elsewhere.
- UI copy follows a formal descriptive tone, avoids personal pronouns, and never uses em dashes, en dashes, or semicolons. `npm run check:copy` enforces the punctuation rule.
- Every color lives in `apps/dashboard/src/client/styles/tokens.css` and `shared/tokens.ts`, and a unit test keeps both files identical. `npm run check:tokens` rejects hard coded colors in client source.
- `design/` is a read only reference. Design changes are exported again from Claude Design and replace the folder in a dedicated commit.
- Chrome caches favicons aggressively. A new Incognito window shows icon changes immediately.

## Roadmap

- Serve the dashboard favicon on the redirector visitor pages.
- Clean up the legacy stack by removing the Strapi `short-link` collection, the `/api/s/:slug` route, and the nginx virtual host for `s.daffa.me`, then point the `s` DNS record to a dummy address.
- Phase 2 covers a UTM builder, click limits, per link passwords, custom social previews, and device targeting.
- Phase 3 covers an API with tokens, bulk CSV import, and periodic broken link checks. Access service tokens carry no email claim, so the JWT check needs adjustment at that stage.

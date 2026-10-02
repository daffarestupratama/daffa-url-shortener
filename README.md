# daffa-url-shortener

Personal URL shortener with click analytics and a free public tier. Short links resolve at `daffa.me/{slug}`. `link.daffa.me` serves a public page where anyone can shorten a URL, and a private dashboard at `link.daffa.me/dashboard` manages links, moderates public links, and presents visitor analytics. The whole system runs on the Cloudflare free plan.

## Use case

The project replaces an earlier shortener built on Strapi at `s.daffa.me`. Private links are created by hand from the dashboard, and every visit is recorded with location, network, device, and referrer data. The dashboard shows analytics per link, keeps link preview bots separate from human visits, and generates a static QR code for every link. Old `s.daffa.me` links remain valid through a permanent redirect to `daffa.me`.

Public links are created anonymously on `link.daffa.me`. They get a random six character slug, open through a notice page that names the destination, keep counters only, and stay inside daily and hourly limits that protect the free plan quotas. The owner can disable, delete, and block them by domain.

## Architecture

One repository holds two Cloudflare Workers that share one D1 database.

| Worker | Hostname | Role |
|---|---|---|
| `daffa-redirector` | `daffa.me` | Looks up the slug, redirects private links and serves the notice page of public links, logs the click, and serves the 404, 410, 429, and 503 visitor pages |
| `daffa-dashboard` | `link.daffa.me` | Hono JSON API under `/api/admin` (owner) and `/api/public` (anonymous), a daily cron, and a React single page application served as static assets for `/` (public page) and `/dashboard` |

The split isolates the public redirect path. A faulty dashboard deploy cannot break published links, and the SPA fallback of the dashboard never intercepts slugs. The root `daffa.me` without a slug redirects to `daffarestupratama.com`. The former dashboard hostname `shorten.daffa.me` is retired without a redirect.

### Redirect flow

1. The path is lowercased and stripped of a trailing slash. Any path that fails the slug pattern receives a 404 without a database query.
2. One indexed D1 lookup finds the link.
3. An active link receives a 302 with a `no-store, private` Cache-Control header, so browsers never cache the redirect and every visit stays countable.
4. Click logging runs in `ctx.waitUntil` after the response, so logging never delays the redirect. HEAD requests are not logged.
5. Inactive or expired links receive 410, unknown slugs receive 404, and database failures receive 503.

Incoming query strings are ignored. The redirect always points to the stored destination exactly as saved.

A public link never redirects straight away. It serves a notice page with the destination and a Continue link, and counts the visit in counters only (link total, link today, shared daily budget), without a `clicks` row. After 500 clicks of one link in a UTC day, or 20.000 clicks of all public links together, it answers 429 with `Retry-After` until 00:00 UTC (07:00 WIB).

### Public link creation

`POST /api/public/links` checks each request in a fixed order and stops at the first failure, so cheap refusals never reach Turnstile or the counters:

1. Both secrets configured, otherwise 500. CSRF origin check and an 8 KB body limit.
2. Body shape: only `url`, `slug`, and `turnstileToken`. A slug must be one the page could draw (six characters from the generator alphabet, not reserved). A missing token is refused here.
3. URL rules (`checkPublicUrl`): http or https, a dotted hostname, at most 2048 characters, no IP address, no `daffa.me` host, no other URL shortener.
4. Blocked domains: the host and every parent domain in one indexed lookup.
5. Turnstile siteverify: success, and the hostname `link.daffa.me`.
6. Hourly limits and the insert in one transaction: 5 links per visitor and 30 links in total per clock hour. Only successful creations count. A visitor is an HMAC-SHA-256 of `CF-Connecting-IP` keyed with `RATE_LIMIT_SECRET` (IPv6 per /64), so no raw IP is stored.

A taken slug is replaced by a new random one, and the answer holds only the slug, the short URL, the stored destination, and the creation time. The work per request stays near 0.1 ms of CPU. D1 and siteverify are I/O waits.

### Recorded click data

Timestamp, full IP address from `CF-Connecting-IP`, raw User-Agent, bot flag, country, region, city, timezone, Cloudflare data center (IATA colo code), ASN, AS organization, and referrer. Location and network fields come from `request.cf` at no CPU cost. Raw IP addresses are kept indefinitely and are deleted manually through the D1 console when needed.

### Performance rules

- The free plan allows 10 ms of CPU per request. The redirect path never parses User-Agents and detects bots with a single regular expression test.
- User-Agent parsing, charts, and QR generation run in the browser. The API returns grouped raw data.
- Aggregations run in SQL against two indexes on `clicks`. `npm run explain` confirms that no query scans the full `clicks` table, and that the redirector, the public endpoint, the lists, moderation, and the cron reach every stored table through an index.
- Visitor pages are single HTML documents with inline CSS, no JavaScript, no web fonts, and a hard limit of 3 KB.

### Security

- Cloudflare Access protects `/dashboard` and `/api/admin` on `link.daffa.me`. Login uses Google, and the Access policy allows a single email address. The Google OAuth app stays in Testing mode with the owner account as the only test user. The public page and `/api/public` stay open.
- The Worker verifies the Access JWT from `Cf-Access-Jwt-Assertion` on every `/api/admin` request with `jose` against the team JWKS, checking signature (RS256 only), audience, issuer, and expiry. Missing configuration fails closed with a 500.
- Every POST, PATCH, and DELETE request, owner or public, requires the origin `https://link.daffa.me` and a JSON content type as CSRF protection.
- Public creation is protected by Turnstile, hourly limits, and the blocked domains list. Public endpoints never return owner data, tags, other links, or counters.
- The `workers.dev` route and preview URLs of the dashboard are disabled, so Access cannot be bypassed.
- `apps/dashboard/public/_headers` sets `X-Frame-Options DENY`, `frame-ancestors 'none'`, `nosniff`, and a strict referrer policy on static assets, and `X-Robots-Tag: noindex` on `/dashboard`. API answers carry `Cache-Control: no-store` and `X-Robots-Tag: noindex`.
- A local bypass exists only when `DEV_AUTH_BYPASS=true` is set in `.dev.vars` and the request host is `localhost` or `127.0.0.1`. It skips Access, accepts the local origin for CSRF, and accepts the hostnames that Turnstile test keys report (`localhost`, and `example.com` as observed for the test secret).

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
│   │   ├── src/pages.ts     visitor pages and the public link notice
│   │   ├── src/sql.ts       every redirector statement
│   │   └── wrangler.jsonc
│   └── dashboard/           Worker for link.daffa.me
│       ├── src/worker/      Hono API (routes/ for admin and public), Access auth,
│       │                    CSRF, Turnstile, rate limit buckets, cursors, cron,
│       │                    validation, SQL queries
│       ├── src/client/      React app (components, features, lib, styles)
│       ├── public/          _headers, favicons, og.png, robots.txt, sitemap.xml
│       ├── index.html       meta tags, Open Graph, Turnstile site key
│       ├── .env.development and .env.production   public Turnstile site keys
│       ├── vite.config.ts
│       ├── wrangler.jsonc
│       └── .dev.vars.example
├── shared/                  code used by both Workers and the client
│                            (slug rules, URL normalization and validation, tags,
│                            status, bot regex, public link rules, domain matching,
│                            design tokens, time helpers, API types, tests)
├── migrations/              D1 schema (0001_init.sql, 0002_public_links.sql)
├── scripts/                 Node scripts for seeding, audits, smoke tests, icons,
│                            the Open Graph image, and the local cron trigger
├── design/                  Claude Design handoff bundle, read only reference
├── package.json             workspaces and all npm scripts
├── tsconfig.json
└── vitest.config.ts
```

## Data model

| Table | Content |
|---|---|
| `links` | slug (unique), destination URL, title, description, active flag, expiry, timestamps, visibility flag `is_public`, and for public links the counters `click_total`, `click_day`, `click_today` |
| `tags` and `link_tags` | tag names and the many to many relation, private links only |
| `clicks` | one row per visit of a private link with the fields listed above |
| `blocked_domains` | hostnames refused for new public links, each covering its subdomains |
| `rate_limits` | public creation counts per clock hour, bucket `global` or `ip:` plus an HMAC |
| `public_click_budget` | clicks of all public links per UTC day |

Indexes `idx_clicks_link_ts (link_id, ts)` and `idx_clicks_link_bot_ts (link_id, is_bot, ts)` serve every analytics query, and `idx_links_public_created (is_public, created_at)` serves both tabs of the links list. A daily cron at 00:15 UTC deletes `rate_limits` rows older than one day and `public_click_budget` rows older than seven days. Link status is never stored. Status is derived from the active flag and the expiry date. Deleting a link cascades to the clicks and tag relations of that link. All timestamps are epoch milliseconds, and the dashboard displays every timestamp in WIB (UTC+7).

## Link rules

- Slug pattern `^[a-z0-9][a-z0-9-]{1,79}$`, which allows 2 to 80 lowercase characters and forbids a leading hyphen. The pattern matches the legacy shortener, so all old slugs remain valid.
- Reserved slugs are `api admin dashboard shorten www static assets login logout health qr favicon robots`.
- Generated slugs use 6 characters from `abcdefghijkmnpqrstuvwxyz23456789`, which excludes look alike characters.
- Destinations are normalized first (`normalizeUrlInput` in `shared/url.ts`): surrounding whitespace is trimmed, and an address without a scheme, such as `example.com/page`, gains `https://`. An explicit `http://` or `https://` is kept as typed, and the normalized value is what gets stored. Any other scheme, such as `javascript:` or `data:`, is rejected.
- Destinations must use http or https and a dotted hostname, so `localhost:3000` stays invalid. `daffa.me` and `www.daffa.me` are rejected to prevent redirect loops. Other `daffa.me` subdomains are allowed for private links.
- Reactivating an expired link clears the expiry date.
- QR codes encode `https://daffa.me/{slug}`, not the destination, so printed codes survive destination changes.

### Public links

- Slugs are exactly 6 characters from the generator alphabet, drawn by the page. A slug taken in the meantime is replaced by the server.
- Destinations follow the stricter `checkPublicUrl`: at most 2048 characters after normalization, no IP address, no host under `daffa.me`, no other URL shortener, and no host under a blocked domain. The parsed form is stored, with a lowercase host.
- The title is the hostname without `www`. Public links have no tags, no description, and no expiry, and are never edited. The owner can only disable, enable, or delete them. A deleted public link frees its slug.
- Limits: 5 creations per visitor and 30 in total per clock hour, 500 clicks per link and 20.000 clicks in total per UTC day.

## Analytics definitions

- A unique visitor is a distinct combination of IP address and User-Agent.
- Human and bot clicks are counted separately. Rankings and network panels use human clicks only.
- Ranges are 24h (hourly buckets), 7d, 30d, and 90d (daily buckets in WIB), and all (monthly buckets).
- The chart marks a peak only when at least three buckets hold clicks and the peak reaches three times the median.
- Numbers use the `1.234` format and dates use the `27 Sep 2026` format.

## API

Owner API, behind Cloudflare Access and the JWT check:

```
GET    /api/admin/me
GET    /api/admin/summary                       includes publicTotal and publicClicksToday of 20.000
GET    /api/admin/links?visibility&q&tag&status&sort&cursor
                                                visibility is private (default) or public
                                                sort is newest, oldest, clicks, or least
POST   /api/admin/links
GET    /api/admin/links/{id}                    private links only, like every /links/{id} route
PATCH  /api/admin/links/{id}
DELETE /api/admin/links/{id}
POST   /api/admin/links/{id}/toggle
GET    /api/admin/slugs/{slug}/available?exclude={id}
GET    /api/admin/tags
GET    /api/admin/links/{id}/analytics?range=24h|7d|30d|90d|all
GET    /api/admin/links/{id}/clicks?range&page
PATCH  /api/admin/public-links/{id}             { isActive }
DELETE /api/admin/public-links/{id}             frees the slug
GET    /api/admin/blocked-domains?q
GET    /api/admin/blocked-domains/check?host    covering entry and active public links on the host
POST   /api/admin/blocked-domains               { host, disableActive }
DELETE /api/admin/blocked-domains/{host}
```

The links list returns 25 rows per page as `{ visibility, links, nextCursor, counts }`. The next page is `?cursor={nextCursor}` with the same filters. Pagination is keyset on (sort key, id), and every page of one listing reads the same moment, so private rows never repeat or go missing. Public click totals are live, so a click sort on the public tab can shift between pages. `counts` holds `{ matching, total }` per tab for the tab labels, and the tag filter narrows private links only.

Public API, without Access:

```
POST   /api/public/links                        { url, slug?, turnstileToken }
                                                201 { slug, shortUrl, url, createdAt }
```

Errors always follow the shape `{ "error": { "code", "message" } }`. A public `invalid_url` adds `reason` (`required`, `too_long`, `invalid`, `ip`, `loop`, or `shortener`). `rate_limited_ip` and `rate_limited_global` add `resetAt`, the start of the next clock hour, and a `Retry-After` header. Other public codes are `blocked_domain`, `turnstile_failed`, and `turnstile_unavailable`.

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
| `npm run check:bundle` | Checks the dashboard build for dev only code, CDN URLs, headers, favicons, robots and sitemap, Open Graph tags and image, the Turnstile site key, and bundle size |
| `npm run explain` | Prints the query plan of every SQL statement and fails on a full scan of `clicks` or on any stored table scan in a case marked as index only |
| `npm run smoke` | End to end API test against a running `npm run dev` |
| `npm run cron:local` | Fires the daily cron once against a running `npm run dev` |
| `npm run db:counts` | Prints row counts of the local database |
| `npm run icons` | Regenerates the favicons and the 1200x630 Open Graph image from the design tokens |
| `npm run migrate:remote` | Applies migrations to the production database |
| `npm run deploy:redirect` | Deploys the redirector |
| `npm run deploy:dashboard` | Builds and deploys the dashboard |

## Local development

1. Install dependencies with `npm install`.
2. Copy `apps/dashboard/.dev.vars.example` to `apps/dashboard/.dev.vars` and keep `DEV_AUTH_BYPASS=true`. The file is ignored by git. It also holds the Cloudflare Turnstile test secret that always passes and a local `RATE_LIMIT_SECRET`.
3. Run `npm run migrate:local` and `npm run seed:local`.
4. Run `npm run dev`, then open `http://localhost:5173` for the dashboard and `http://127.0.0.1:8787/{slug}` for redirects.

Notes for local work

- Both Workers share one local database in `.wrangler-state`. The file name derives from the D1 `database_id`, so a changed id starts an empty local database that needs migrate and seed again.
- Locally the public page uses the Turnstile test site key from `.env.development`, whose tokens are the dummy token `XXXX.DUMMY.TOKEN.XXXX`. The test secret accepts it, and siteverify then reports the hostname `example.com`, which only the local bypass accepts.
- The daily cron runs with `npm run cron:local`, or `curl "http://localhost:5173/cdn-cgi/local/scheduled?cron=15+0+*+*+*"`. The purge counts appear in the `npm run dev` output.
- The seed script deletes all local data first. Seed links keep stable ids (for example `/links/1` is `cv` and `/links/9` has no clicks).
- In development only, `?state=loading|error|empty|noresults|notfound|flat` and `?overlay=create|edit|qr|delete|toast` force any designed state for visual checks. Both parameters are removed from production builds.
- Local data never touches production.

## Deployment

The standard workflow is change locally, verify with `npm run check`, commit, then deploy the affected Worker with `npm run deploy:redirect` or `npm run deploy:dashboard`.

- Run `npm run migrate:remote` only when a new file appears in `migrations/`. Code or style changes never need a migration.
- Wrangler commands for the dashboard must run inside the dashboard workspace, because the Vite plugin writes a redirected Wrangler config there during the build. Secrets are set with `npm exec -w @daffa/dashboard -- wrangler secret put NAME`.
- The dashboard needs four production secrets. `ACCESS_TEAM_DOMAIN` holds the Zero Trust team domain without the scheme, `ACCESS_AUD` holds the Application Audience tag of the Access application, `TURNSTILE_SECRET` holds the secret key of the Turnstile widget, and `RATE_LIMIT_SECRET` holds a long random value that keys the visitor buckets.
- The Turnstile site key is public and is built into `index.html` from `VITE_TURNSTILE_SITE_KEY` in `apps/dashboard/.env.production`. `npm run check:bundle` fails while that file still holds the placeholder or any Turnstile test key.
- If a fresh dashboard deploy serves a blank or broken page, deploying again without changes resolves a known intermittent Vite plugin issue.

### Cloudflare configuration outside the repository

| Item | Setting |
|---|---|
| D1 | Database `daffa-links`, APAC location |
| Zero Trust | Google identity provider, Access application `Link Manager` on `link.daffa.me` covering the paths `/dashboard` and `/api/admin` only, allow policy for one email, Google as the only login method with instant authentication, one month session |
| Turnstile | Managed widget for the hostname `link.daffa.me`. The site key goes in `.env.production`, the secret key in `TURNSTILE_SECRET` |
| Redirect Rule | `www.daffa.me` to `daffa.me` with the path kept, status 301 |
| Redirect Rule | `s.daffa.me/*` to `daffa.me/${1}`, status 301, query string dropped |
| DNS | `daffa.me` and `link.daffa.me` are Worker custom domains. `shorten.daffa.me` is retired. `www` is a proxied dummy record (192.0.2.1). `s` still points to the legacy VM, proxied, until cleanup |
| Cron | `15 0 * * *` on `daffa-dashboard`, from `wrangler.jsonc` |

### Search engines

`robots.txt` allows `/` and disallows `/dashboard` and `/api`, and `sitemap.xml` lists `https://link.daffa.me/`. The public page carries a title, a description, a canonical link, and Open Graph tags with `og.png`. `/dashboard` paths are excluded through `X-Robots-Tag: noindex` from `_headers`, and API answers send the same header.

## Monitoring

- Workers and Pages, `daffa-redirector` and `daffa-dashboard`, Metrics tab. The Exceeded CPU Time Limits count should stay at zero, and CPU P99 should stay under 10 ms.
- Workers and Pages, `daffa-dashboard`, Cron Events. The daily purge logs how many rows it deleted, and a failed run shows as an error.
- D1, `daffa-links`, Overview tab. Rows read and rows written should stay far below the free plan limits.
- Most redirector traffic from unfamiliar regions comes from automated scanners and link preview crawlers. Invalid paths are answered without a database query.

## Maintenance notes

- The worst case 404 visitor page sits about 50 bytes below the 3 KB limit. Any new content on visitor pages requires savings elsewhere.
- UI copy follows a formal descriptive tone, avoids personal pronouns, and never uses em dashes, en dashes, or semicolons. `npm run check:copy` enforces the punctuation rule.
- Every color lives in `apps/dashboard/src/client/styles/tokens.css` and `shared/tokens.ts`, and a unit test keeps both files identical. `npm run check:tokens` rejects hard coded colors in client source.
- `design/` is a read only reference. Design changes are exported again from Claude Design and replace the folder in a dedicated commit.
- Chrome caches favicons aggressively. A new Incognito window shows icon changes immediately.
- `og.png` is generated by `scripts/og-image.mjs` with a small stroke font that only knows the glyphs of `/daffa.me`. New text on the image needs new glyphs there.

## Roadmap

- Serve the dashboard favicon on the redirector visitor pages.
- Clean up the legacy stack by removing the Strapi `short-link` collection, the `/api/s/:slug` route, and the nginx virtual host for `s.daffa.me`, then point the `s` DNS record to a dummy address.
- Phase 2 covers a UTM builder, click limits, per link passwords, custom social previews, and device targeting.
- Phase 3 covers an API with tokens, bulk CSV import, and periodic broken link checks. Access service tokens carry no email claim, so the JWT check needs adjustment at that stage.

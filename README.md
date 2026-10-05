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

### Client routes

`link.daffa.me` serves one `index.html` for every path outside `/api`. A small boot entry (`main.tsx` with `boot.ts`) holds the global styles and reads the path before any page code loads.

| Path | Result |
|---|---|
| `/` | The public page, loaded as its own chunk |
| `/dashboard` and `/dashboard/links/{id}` | The owner dashboard, loaded as its own chunk, with the detail page lazy on top |
| `/links/{id}` | The former dashboard address, sent to `/dashboard/links/{id}` with a full page load so Access can sign in first |
| Any other path | The public page, with the address rewritten to `/` |

The public page never loads dashboard code, and the dashboard never loads public page code beyond the shared primitives in `components/` and `lib/`. `npm run check:bundle` proves both from the module map of the build. The Turnstile script loads only on the public page, and the QR encoder loads only when a QR code is first shown. The public page keeps the static title and meta tags of `index.html`, and the dashboard sets its own title per route.

### Redirect flow

1. The path is lowercased and stripped of a trailing slash. Any path that fails the slug pattern receives a 404 without a database query.
2. The slug guessing guard checks whether the visitor's network is blocked, in parallel with step 3, so a click waits for nothing extra.
3. One indexed D1 lookup finds the link.
4. An active link receives a 302 with a `no-store, private` Cache-Control header, so browsers never cache the redirect and every visit stays countable.
5. Click logging runs in `ctx.waitUntil` after the response, so logging never delays the redirect. HEAD requests are not logged.
6. Inactive or expired links receive 410, unknown slugs receive 404, and database failures receive 503. A blocked network receives 429 for every slug, before anything is logged or counted.

Incoming query strings are ignored. The redirect always points to the stored destination exactly as saved.

A public link never redirects straight away. It serves a notice page with the destination and a Continue link, and counts the visit in counters only (link total, link today, shared daily budget), without a `clicks` row. After 500 clicks of one link in a UTC day, or 20.000 clicks of all public links together, it answers 429 with `Retry-After` until 00:00 UTC (07:00 WIB).

### Slug guessing guard

Guessing slugs is the only way to find a private link, so the redirector slows guessing down without touching legitimate clicks (`apps/redirector/src/guard.ts`).

- Only misses count, meaning requests that end in the 404 page, for unknown slugs and for paths that fail the slug pattern, by GET or HEAD. A click on an existing link never counts, so many real visitors behind one mobile carrier address (CGNAT) are never limited.
- A 410 does not count. It reveals that a slug exists but never its destination, and an expired link printed on a poster or an event QR code can be opened by many people behind one address at once.
- The 429 daily limit pages, the 503 page, `/`, `/favicon.ico`, `/robots.txt`, other methods, and paths browsers and crawlers request by themselves (`/apple-touch-icon*.png`, `/.well-known/*`, `/sitemap.xml`, `/ads.txt`, `/site.webmanifest`, and similar) never count. Safari asks for the touch icons on every page it shows.
- A network is an IPv4 address or an IPv6 /64, the same rule as the public creation limit (`shared/ip.ts`). It reaches the Workers Rate Limiting binding `MISS_LIMITER` only as an HMAC-SHA-256 keyed with the redirector secret `RATE_LIMIT_SECRET`, so no address is stored or sent anywhere.
- The limit is 10 misses per 60 seconds per network. The eleventh miss and every later request from that network, valid slugs included, receive the 429 attempt limit page with `Retry-After` for 60 seconds. `/`, `/favicon.ico`, and `/robots.txt` stay open.
- The binding has no read only check, so a refused miss leaves a block marker in two places. One is a map in the memory of the isolate. The other is an empty entry in the Cache API of the data center, keyed by the HMAC and expiring after 60 seconds. The cache lookup runs in parallel with the D1 slug lookup, so a click pays no extra latency, and only junk paths without a lookup wait about a millisecond for it. Nothing is written to D1.
- Every failure fails open. A missing secret, a binding error, or a cache error lets the request through normally and is logged once per isolate.
- Counters and markers are per Cloudflare location and eventually consistent. The guard turns thousands of guesses per second into about 10 per one or two minutes for one network, but a guesser with many networks or locations is only slowed, not stopped. Generated six character slugs (32 to the power of 6, about 1,07 billion) stay out of reach either way. Short custom slugs gain the most.

### Public link creation

`POST /api/public/links` checks each request in a fixed order and stops at the first failure, so cheap refusals never reach Turnstile or the counters.

1. Both secrets must be configured, otherwise the answer is 500. The CSRF origin check and an 8 KB body limit come next.
2. The body holds only `url`, `slug`, and `turnstileToken`. A slug must be one the page could draw (six characters from the generator alphabet, not reserved). A missing token is refused here.
3. The URL passes `checkPublicUrl`, which asks for http or https, a dotted hostname, at most 2048 characters, no IP address, no `daffa.me` host, and no other URL shortener.
4. The blocked domains list is checked for the host and every parent domain in one indexed lookup.
5. Turnstile siteverify must report success and the hostname `link.daffa.me`.
6. The hourly limits and the insert run in one transaction, with 5 links per visitor and 30 links in total per clock hour. Only successful creations count. A visitor is an HMAC-SHA-256 of `CF-Connecting-IP` keyed with `RATE_LIMIT_SECRET` (IPv6 per /64), so no raw IP is stored.

A taken slug is replaced by a new random one, and the answer holds only the slug, the short URL, the stored destination, and the creation time. The work per request stays near 0.1 ms of CPU. D1 and siteverify are I/O waits.

The public page draws the slug in the browser with `randomPublicSlug` and runs `checkPublicUrl` itself before sending, so an invalid destination never spends a Turnstile token. Both sides share one module, so the page shows the same message the server would send, and `npm run smoke` checks that they agree. Every request that reaches the server resets the Turnstile widget afterwards, because a token works only once. A rate limit opens a dialog that counts down to `resetAt` in WIB, and a missing answer or `turnstile_unavailable` shows a retry panel inside the form.

### Recorded click data

Timestamp, full IP address from `CF-Connecting-IP`, raw User-Agent, bot flag, country, region, city, timezone, Cloudflare data center (IATA colo code), ASN, AS organization, and referrer. Location and network fields come from `request.cf` at no CPU cost. Raw IP addresses are kept indefinitely and are deleted manually through the D1 console when needed.

### Performance rules

- The free plan allows 10 ms of CPU per request. The redirect path never parses User-Agents and detects bots with a single regular expression test.
- User-Agent parsing, charts, and QR generation run in the browser. The API returns grouped raw data.
- Aggregations run in SQL against two indexes on `clicks`. `npm run explain` confirms that no query scans the full `clicks` table, and that the redirector, the public endpoint, the lists, moderation, and the cron reach every stored table through an index.
- Visitor pages are single HTML documents with inline CSS, no JavaScript, no web fonts, and a hard limit of 3 KB. They cover 404 not found, 410 gone, 503 unavailable, the two 429 pages of the public link daily limits, the 429 attempt limit page of the slug guessing guard, and the 200 notice of public links. The HTML shell of `link.daffa.me` is held to the same limit.
- The slug guessing guard adds no network wait. The Rate Limiting binding counts in memory at the location, and its block marker is read in parallel with the D1 lookup.
- The public page loads the boot entry, the shared primitives, and its own chunk, 88.8 KB of JavaScript and CSS after gzip on 3 Oct 2026, most of it React. `npm run check:bundle` fails above a budget of 98 KB. The chain hero is plain CSS, without an animation library, and shows a static frame under `prefers-reduced-motion`.
- The links list loads 25 rows at a time. An IntersectionObserver requests the next page before the end of the list scrolls into view, and a Load More button does the same by keyboard. Rows are merged by id, so a row never appears twice.

### Security

- Cloudflare Access protects `/dashboard` and `/api/admin` on `link.daffa.me`. Login uses Google, and the Access policy allows a single email address. The Google OAuth app stays in Testing mode with the owner account as the only test user. The public page and `/api/public` stay open. Sign In on the public page is a plain link to `/dashboard`, a full page load, so Access always runs.
- The Worker verifies the Access JWT from `Cf-Access-Jwt-Assertion` on every `/api/admin` request with `jose` against the team JWKS, checking signature (RS256 only), audience, issuer, and expiry. Missing configuration fails closed with a 500.
- Every POST, PATCH, and DELETE request, owner or public, requires the origin `https://link.daffa.me` and a JSON content type as CSRF protection.
- Public creation is protected by Turnstile, hourly limits, and the blocked domains list. Public endpoints never return owner data, tags, other links, or counters.
- `daffa.me` slows down slug guessing with the guard described under Slug guessing guard. It needs no WAF rule, since the single rate limiting rule of the Free plan matches on path only and would also throttle `cms.daffa.me`, `odoo.daffa.me`, and `link.daffa.me`.
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
│   │   ├── src/guard.ts     slug guessing guard (misses, Rate Limiting binding, block marker)
│   │   ├── src/log.ts       click insert inside waitUntil
│   │   ├── src/pages.ts     visitor pages and the public link notice
│   │   ├── src/sql.ts       every redirector statement
│   │   ├── wrangler.jsonc   D1 binding and the MISS_LIMITER rate limit binding
│   │   └── .dev.vars.example
│   └── dashboard/           Worker for link.daffa.me
│       ├── src/worker/      Hono API (routes/ for admin and public), Access auth,
│       │                    CSRF, Turnstile, rate limit buckets, cursors, cron,
│       │                    validation, SQL queries
│       ├── src/client/      React app
│       │   ├── main.tsx, boot.ts   boot entry, picks the public page or the dashboard
│       │   ├── public/      the public page at /
│       │   ├── features/    the owner dashboard at /dashboard
│       │   ├── components/  shared primitives (controls, fields, dialogs, tiles, QR)
│       │   ├── lib/         shared helpers, plus the dashboard API and dev previews
│       │   └── styles/      tokens, fonts, base styles
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
│                            (a build also writes apps/dashboard/dist/client-chunks.json,
│                            the module map that npm run check:bundle reads, never deployed)
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
- Destinations are normalized first with `normalizeUrlInput` in `shared/url.ts`. Surrounding whitespace is trimmed, and an address without a scheme, such as `example.com/page`, gains `https://`. An explicit `http://` or `https://` is kept. Any other scheme, such as `javascript:` or `data:`, is rejected. Both endpoints then store the canonical form from `canonicalUrl`, the serialization of the URL parser, so `http:example.com/x` becomes `http://example.com/x`, the scheme and host are lowercased, and a bare host gains a trailing slash. Links stored before this rule keep their old form. Both forms show the canonical address as `Saved as` under the field whenever it differs from what was typed, apart from the slash after a bare host.
- Destinations must use http or https and a dotted hostname, so `localhost:3000` stays invalid. `daffa.me` and `www.daffa.me` are rejected to prevent redirect loops. Other `daffa.me` subdomains are allowed for private links.
- Reactivating an expired link clears the expiry date.
- QR codes encode `https://daffa.me/{slug}`, not the destination, so printed codes survive destination changes.

### Public links

- Slugs are exactly 6 characters from the generator alphabet, drawn by the page. A slug taken in the meantime is replaced by the server.
- Destinations follow the stricter `checkPublicUrl`, which allows at most 2048 characters after normalization, no IP address, no host under `daffa.me`, no other URL shortener, and no host under a blocked domain. The parsed form is stored, with a lowercase host.
- The title is the hostname without `www`. Public links have no tags, no description, and no expiry, and are never edited. The owner can only disable, enable, or delete them. A deleted public link frees its slug, and a disabled one keeps it reserved.
- The limits are 5 creations per visitor and 30 in total per clock hour, 500 clicks per link and 20.000 clicks in total per UTC day.
- Blocking a domain never affects private links. It can disable the active public links on the domain at the same moment.
- Removing a blocked domain never enables the public links that the block disabled, since those may have been abusive. They stay disabled and are enabled one by one from the Public tab, and the Blocked Domains list and its toast both say so.

## Analytics definitions

- A unique visitor is a distinct combination of IP address and User-Agent.
- Human and bot clicks are counted separately. Rankings and network panels use human clicks only.
- Ranges are 24h (hourly buckets), 7d, 30d, and 90d (daily buckets in WIB), and all (monthly buckets).
- The chart marks a peak only when at least three buckets hold clicks and the peak reaches three times the median.
- Numbers use the `1.234` format and dates use the `27 Sep 2026` format.
- The KPI row of the dashboard has two captioned groups. PRIVATE LINKS holds the active links, human clicks, unique visitors, and the most clicked link, which only private links can provide, since only private visits are logged as `clicks` rows. PUBLIC LINKS holds the public clicks of the day against the shared budget of 20.000, read from the counters.

## API

The owner API sits behind Cloudflare Access and the JWT check.

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

The public API works without Access.

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
| `npm run seed:many` | Adds about 60 private and 60 public links on top of `seed:local`, so infinite scroll can be checked by eye. Running `npm run seed:local` again removes them |
| `npm run check` | Typecheck, unit tests, visitor page and HTML shell size, copy audit, and token audit |
| `npm test` | Unit tests only |
| `npm run build:dashboard` | Builds the dashboard |
| `npm run check:bundle` | Checks the dashboard build for dev only code, CDN URLs, headers, favicons, robots and sitemap, Open Graph tags and image, the Turnstile site key, the route split between the public page and the dashboard, and the size budget of the public page |
| `npm run explain` | Prints the query plan of every SQL statement and fails on a full scan of `clicks` or on any stored table scan in a case marked as index only |
| `npm run smoke` | End to end API test against a running `npm run dev`, including the page by page walk of both dashboard tabs and every client route. Expects the `seed:local` data |
| `npm run cron:local` | Fires the daily cron once against a running `npm run dev` |
| `npm run db:counts` | Prints row counts of the local database |
| `npm run icons` | Regenerates the favicons and the 1200x630 Open Graph image from the design tokens |
| `npm run migrate:remote` | Applies migrations to the production database |
| `npm run deploy:redirect` | Deploys the redirector |
| `npm run deploy:dashboard` | Builds and deploys the dashboard |

## Local development

1. Install dependencies with `npm install`.
2. Copy `apps/dashboard/.dev.vars.example` to `apps/dashboard/.dev.vars` and keep `DEV_AUTH_BYPASS=true`. The file is ignored by git. It also holds the Cloudflare Turnstile test secret that always passes and a local `RATE_LIMIT_SECRET`.
3. Copy `apps/redirector/.dev.vars.example` to `apps/redirector/.dev.vars`. It holds a local `RATE_LIMIT_SECRET` for the slug guessing guard, which stays off without it. The file is ignored by git.
4. Run `npm run migrate:local` and `npm run seed:local`.
5. Run `npm run dev`, then open `http://localhost:5173` for the public page, `http://localhost:5173/dashboard` for the dashboard, and `http://127.0.0.1:8787/{slug}` for redirects.

Notes for local work

- Both Workers share one local database in `.wrangler-state`. The file name derives from the D1 `database_id`, so a changed id starts an empty local database that needs migrate and seed again.
- Locally the public page uses the Turnstile test site key from `.env.development`, whose tokens are the dummy token `XXXX.DUMMY.TOKEN.XXXX`. The test secret accepts it, and siteverify then reports the hostname `example.com`, which only the local bypass accepts.
- The daily cron runs with `npm run cron:local`, or `curl "http://localhost:5173/cdn-cgi/local/scheduled?cron=15+0+*+*+*"`. The purge counts appear in the `npm run dev` output.
- The seed script deletes all local data first. Seed links keep stable ids (for example `/dashboard/links/1` is `cv` and `/dashboard/links/9` has no clicks). `npm run seed:many` adds rows on top without changing those ids.
- In development only, `?state=` and `?overlay=` force any designed state for visual checks, and both combine. Previews never change data. Every dialog, drawer, menu, or form a preview opens or fills only closes on its confirm button, while the same dialog opened by hand stays fully live. Both parameters and every value below are removed from production builds, which `npm run check:bundle` verifies.
- Local data never touches production.

Preview URLs of the public page

| URL | Shows |
|---|---|
| `/?state=filled` and `/?state=submitting` | A filled form, and the busy form |
| `/?state=success` | The result card with copy and the QR code |
| `/?state=invalid`, `ip`, `too-long`, `loop`, `shortener` | The field message for each `invalid_url` reason |
| `/?state=blocked` | The blocked domain message |
| `/?state=turnstile`, `turnstile-pending`, `turnstile-offline` | The Turnstile slot when the check failed, when no token exists yet, and when the script could not load |
| `/?state=network` and `/?state=unavailable` | The retry panel |
| `/?state=static-hero` | The static frame of the chain hero, as `prefers-reduced-motion` shows it |
| `/?overlay=rate-visitor` and `/?overlay=rate-global` | Both rate limit dialogs, counting down to the next hour |
| `/?overlay=toast` | A toast that stays |

Preview URLs of the dashboard

| URL | Shows |
|---|---|
| `/dashboard?state=loading`, `error`, `empty`, `noresults` | The list states of the active tab, with `&tab=public` for the Public tab |
| `/dashboard?state=loading-more` | The Load More footer while busy |
| `/dashboard?state=budget-warn` and `/dashboard?state=budget-full` | The public budget at 75 and 95 percent |
| `/dashboard?overlay=create`, `create-errors`, `create-ok`, `create-url` | The create form, with field errors, with a free slug, and with the `Saved as` line |
| `/dashboard?overlay=edit`, `qr`, `delete`, `menu`, `tag`, `sort`, `toast` | Overlays of the first private link and the toolbar |
| `/dashboard?tab=public&tag=career` | The note that the tag filter applies to private links only |
| `/dashboard?tab=public&overlay=menu` and `menu-blocked` | The menu of the first public link, also as on a blocked domain |
| `/dashboard?tab=public&overlay=public-qr`, `public-delete` | The QR code and the delete dialog of the first public link |
| `/dashboard?tab=public&overlay=block`, `block-none`, `block-covered` | The block dialog, with and without active links, and for a domain already covered |
| `/dashboard?overlay=blocked`, `blocked-empty`, `blocked-nomatch` | The Blocked Domains list, empty, and with a search that matches nothing |
| `/dashboard/links/1?state=loading`, `error`, `empty`, `notfound`, `flat` | The states of the analytics page |
| `/dashboard/links/1?overlay=edit`, `qr`, `delete`, `toast` | Overlays of the analytics page |

Narrow screens

- The status filter wraps below a 324 px viewport, the link tabs below about 392 px with two digit counts (384 px with one digit, 409 px with three), and the time range of the analytics page below 435 px. Wrapped options stretch to fill each row, and on one row nothing changes.
- The PRIVATE LINKS and PUBLIC LINKS groups of the KPI row share one row from a 1256 px viewport. Below that the public group moves under its own caption.

## Deployment

The standard workflow is change locally, verify with `npm run check`, commit, then deploy the affected Worker with `npm run deploy:redirect` or `npm run deploy:dashboard`.

- Run `npm run migrate:remote` only when a new file appears in `migrations/`. Code or style changes never need a migration.
- Wrangler commands for the dashboard must run inside the dashboard workspace, because the Vite plugin writes a redirected Wrangler config there during the build. Secrets are set with `npm exec -w @daffa/dashboard -- wrangler secret put NAME`.
- The dashboard needs four production secrets. `ACCESS_TEAM_DOMAIN` holds the Zero Trust team domain without the scheme, `ACCESS_AUD` holds the Application Audience tag of the Access application, `TURNSTILE_SECRET` holds the secret key of the Turnstile widget, and `RATE_LIMIT_SECRET` holds a long random value that keys the visitor buckets.
- The redirector needs one production secret, `RATE_LIMIT_SECRET`, a long random value of its own that keys the HMAC of the slug guessing guard. The owner sets it once with `npx wrangler secret put RATE_LIMIT_SECRET -c apps/redirector/wrangler.jsonc` before deploying the guard. Without it the guard stays off and logs an error. The Rate Limiting binding `MISS_LIMITER` uses `namespace_id` 1001, which must stay unique in the account.
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
- Workers and Pages, `daffa-redirector`, Logs. A line starting with `slug guard` means the guard failed open, for a missing `RATE_LIMIT_SECRET`, a missing binding, or a binding or cache error. Each kind appears at most once per isolate.

## Maintenance notes

- The worst case 404 visitor page sits about 50 bytes below the 3 KB limit, and the attempt limit page about 55 bytes. Any new content on visitor pages requires savings elsewhere.
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

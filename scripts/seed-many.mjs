import { importTs } from './bundle.mjs';
import { d1Local } from './d1.mjs';

/**
 * Adds about 60 private and 60 public links on top of `npm run seed:local`,
 * so the infinite scroll of both tabs can be checked by eye. Local database
 * only, through the same `wrangler d1 execute --local` as the other scripts.
 *
 * The rows are recognizable: private slugs are many-01 to many-60, and public
 * destinations carry the query parameter seed-many=1. Running this again first
 * removes its own earlier rows, so it is idempotent. `npm run seed:local` wipes
 * the whole database, so it removes these rows too and restores the base data
 * that `npm run smoke` expects.
 *
 * Every value comes from a fixed PRNG, so reruns produce the same rows apart
 * from timestamps, which follow the current time.
 */

const PRIVATE_COUNT = 60;
const PUBLIC_COUNT = 60;
const MARK = 'seed-many=1';

const NOW = Date.now();
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const UTC_TODAY = Math.floor(NOW / DAY) * DAY;

function rng(seed) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = rng(20261003);
const pick = (list) => list[Math.floor(rand() * list.length)];
const between = (low, high) => low + Math.floor(rand() * (high - low + 1));
const quote = (value) => (value === null || value === undefined ? 'NULL' : `'${String(value).replace(/'/g, "''")}'`);

const { randomPublicSlug } = await importTs('shared/public.ts');

// The base data must be there: these rows extend it, they do not replace it.
const [base] = await d1Local("SELECT COUNT(*) AS n FROM links WHERE slug = 'cv';");
if (!base?.results?.[0]?.n) {
  console.error('The local database has no seed data. Run `npm run seed:local` first, then this script.');
  process.exit(1);
}

// Remove the rows of an earlier run. Child rows go first, whether or not the
// local database enforces the cascades.
const OWN = `(slug LIKE 'many-%' OR (is_public = 1 AND url LIKE '%${MARK}%'))`;
await d1Local(
  [
    `DELETE FROM clicks WHERE link_id IN (SELECT id FROM links WHERE ${OWN});`,
    `DELETE FROM link_tags WHERE link_id IN (SELECT id FROM links WHERE ${OWN});`,
    `DELETE FROM links WHERE ${OWN};`,
  ].join('\n'),
);

const [taken] = await d1Local('SELECT slug FROM links;');
const usedSlugs = new Set((taken?.results ?? []).map((row) => row.slug));

// Private links -----------------------------------------------------------------

const TOPICS = [
  ['Thesis draft', 'drive.google.com/file/d/1Th3s1sDr4ft'],
  ['Lecture notes on regression', 'notion.so/Lecture-Regression-7c2e'],
  ['Kaggle notebook', 'kaggle.com/code/daffarestupratama/eda'],
  ['Conference talk slides', 'speakerdeck.com/daffarestupratama/talk'],
  ['Open source contribution', 'github.com/daffarestupratama/contrib'],
  ['Workshop registration', 'forms.gle/W0rksh0pReg'],
  ['Reading list', 'notion.so/Reading-List-91ab'],
  ['Dataset archive', 'drive.google.com/drive/folders/1DataArch'],
  ['Teaching assistant schedule', 'calendar.app.google/TaSch3dule'],
  ['Portfolio case study', 'daffarestupratama.com/case-study'],
  ['Newsletter issue', 'daffarestupratama.substack.com/p/issue'],
  ['Community meetup photos', 'photos.app.goo.gl/MeetupPh0tos'],
];
const TAGS = ['career', 'portfolio', 'contact', 'data', 'code', 'event', 'archive', 'teaching'];

const privateRows = [];
const tagPairs = [];
for (let i = 1; i <= PRIVATE_COUNT; i += 1) {
  const slug = `many-${String(i).padStart(2, '0')}`;
  const [topic, path] = TOPICS[(i - 1) % TOPICS.length];
  const createdAt = NOW - between(1, 90) * DAY - between(0, 23) * HOUR;
  // Every 7th inactive, every 9th expired, every 5th with a future expiry.
  const active = i % 7 !== 0;
  const expiresAt = i % 9 === 0 ? NOW - between(1, 10) * DAY : i % 5 === 0 ? NOW + between(5, 60) * DAY : null;
  privateRows.push(
    `(${quote(slug)}, ${quote(`https://${path}/${slug}`)}, ${quote(`${topic} ${i}`)}, ${quote(`Extra link ${i} for checking long lists.`)}, ${active ? 1 : 0}, ${expiresAt ?? 'NULL'}, ${createdAt}, ${createdAt})`,
  );
  const tagCount = i % 4;
  const chosen = new Set();
  for (let t = 0; t < tagCount; t += 1) chosen.add(pick(TAGS));
  for (const tag of chosen) tagPairs.push([slug, tag]);
}

await d1Local(
  [
    `INSERT INTO links (slug, url, title, description, is_active, expires_at, created_at, updated_at) VALUES\n${privateRows.join(',\n')};`,
    `INSERT OR IGNORE INTO tags (name) VALUES ${TAGS.map((tag) => `(${quote(tag)})`).join(', ')};`,
    ...tagPairs.map(
      ([slug, tag]) =>
        `INSERT INTO link_tags (link_id, tag_id) SELECT l.id, t.id FROM links l, tags t WHERE l.slug = ${quote(slug)} AND t.name = ${quote(tag)};`,
    ),
  ].join('\n'),
);

// Clicks for about half of the private links, mostly inside the 7 day window,
// so the click sorts and the KPI row change.
const [ids] = await d1Local("SELECT id, slug, created_at FROM links WHERE slug LIKE 'many-%' ORDER BY slug;");
const NETWORKS = [
  ['36.72.{a}.{b}', 7713, 'PT TELKOM INDONESIA', 'ID', 'Jakarta', 'Jakarta', 'Asia/Jakarta', 'CGK'],
  ['114.124.{a}.{b}', 23693, 'PT Telekomunikasi Selular', 'ID', 'West Java', 'Depok', 'Asia/Jakarta', 'CGK'],
  ['203.117.{a}.{b}', 9506, 'Singtel Fibre Broadband', 'SG', 'Singapore', 'Singapore', 'Asia/Singapore', 'SIN'],
];
const HUMAN_UA =
  'Mozilla/5.0 (Linux; Android 15; SM-S921B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.6668.70 Mobile Safari/537.36';
const BOT_UA = 'WhatsApp/2.24.17.78 A';
const clickRows = [];
for (const row of ids?.results ?? []) {
  if (rand() < 0.5) continue;
  const count = between(3, 40);
  for (let c = 0; c < count; c += 1) {
    const ts = Math.max(row.created_at, NOW - between(0, 10) * DAY - between(0, 23 * 60) * MINUTE);
    const [ip, asn, org, country, region, city, tz, colo] = pick(NETWORKS);
    const bot = rand() < 0.15;
    const address = ip.replace('{a}', String(between(1, 254))).replace('{b}', String(between(1, 254)));
    clickRows.push(
      `(${row.id}, ${ts}, ${quote(address)}, ${quote(bot ? BOT_UA : HUMAN_UA)}, ${bot ? 1 : 0}, ${quote(country)}, ${quote(region)}, ${quote(city)}, ${quote(tz)}, ${quote(colo)}, ${asn}, ${quote(org)}, NULL)`,
    );
  }
}
for (let offset = 0; offset < clickRows.length; offset += 200) {
  await d1Local(
    `INSERT INTO clicks (link_id, ts, ip, ua, is_bot, country, region, city, timezone, colo, asn, as_org, referrer) VALUES\n${clickRows
      .slice(offset, offset + 200)
      .join(',\n')};`,
  );
}

// Public links --------------------------------------------------------------------

const DESTINATIONS = [
  'https://docs.google.com/forms/d/e/1FAIpQLSeMany/viewform',
  'https://www.tokopedia.com/toko/produk-contoh',
  'https://www.youtube.com/watch?v=SeedMany01',
  'https://www.notion.so/Catatan-Seed-Many',
  'https://drive.google.com/drive/folders/1SeedMany',
  'https://www.canva.com/design/SeedMany/view',
  'https://github.com/contoh/proyek-akhir',
  'https://www.instagram.com/p/SeedMany/',
  'https://grabgift-promo.com/klaim',
  'https://docs.example.org/guide/getting-started',
];
let publicDraws = 0;
const slugRand = rng(73);
const fill = (bytes) => {
  for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(slugRand() * 256);
  return bytes;
};
const publicRows = [];
while (publicRows.length < PUBLIC_COUNT && publicDraws < PUBLIC_COUNT * 20) {
  publicDraws += 1;
  const slug = randomPublicSlug(fill);
  if (usedSlugs.has(slug)) continue;
  usedSlugs.add(slug);
  const n = publicRows.length + 1;
  const destination = DESTINATIONS[(n - 1) % DESTINATIONS.length];
  const url = `${destination}${destination.includes('?') ? '&' : '?'}${MARK}&n=${n}`;
  const host = new URL(url).hostname.replace(/^www\./, '');
  const createdAt = NOW - between(1, 60 * 24) * HOUR;
  // A few at or past the daily limit, a few inactive, everything on the
  // blocked domain inactive, as moderation would have left it.
  const atLimit = n % 17 === 0;
  const today = atLimit ? 500 + between(0, 20) : between(0, 300);
  const total = today + between(0, 5000);
  const active = !host.endsWith('grabgift-promo.com') && n % 11 !== 0;
  publicRows.push(
    `(${quote(slug)}, ${quote(url)}, ${quote(host)}, '', ${active ? 1 : 0}, NULL, ${createdAt}, ${createdAt}, 1, ${total}, ${UTC_TODAY}, ${today})`,
  );
}

await d1Local(
  [
    `INSERT INTO links (slug, url, title, description, is_active, expires_at, created_at, updated_at, is_public, click_total, click_day, click_today) VALUES\n${publicRows.join(',\n')};`,
    // The shared daily budget follows the public counters of today.
    `INSERT INTO public_click_budget (day, clicks) VALUES (${UTC_TODAY}, (SELECT COALESCE(SUM(click_today), 0) FROM links WHERE is_public = 1 AND click_day = ${UTC_TODAY})) ON CONFLICT(day) DO UPDATE SET clicks = excluded.clicks;`,
  ].join('\n'),
);

const [totals] = await d1Local(
  'SELECT SUM(is_public = 0) AS private, SUM(is_public = 1) AS public FROM links;',
);
const summary = totals?.results?.[0] ?? {};
console.log(`Added ${PRIVATE_COUNT} private links (many-01 to many-${PRIVATE_COUNT}), ${clickRows.length} clicks, and ${publicRows.length} public links.`);
console.log(`The local database now holds ${summary.private} private and ${summary.public} public links.`);
console.log('Run `npm run seed:local` to return to the base data.');

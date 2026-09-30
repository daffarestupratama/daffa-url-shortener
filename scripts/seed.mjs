import { spawnSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ROOT } from './bundle.mjs';

/**
 * Fills the local D1 database with demo data. Generates a SQL file, then hands
 * it to `wrangler d1 execute --local` against the shared state directory both
 * Workers use. The generated file is gitignored.
 *
 * Reference values for the distributions come from the design prototype, so the
 * dashboard renders against numbers shaped like the ones it was designed for.
 */

const SQL_FILE = '.seed.generated.sql';
const WIB = 7 * 60 * 60 * 1000;
const DAY = 24 * 60 * 60 * 1000;
const WINDOW_DAYS = 90;
const BOT_SHARE = 0.15;

const NOW = Date.now();

// Deterministic PRNG, ported from the prototype so reruns produce the same data.
function hash(value) {
  let h = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

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

function weightedPick(items, rand) {
  const total = items.reduce((sum, item) => sum + item.weight, 0);
  let roll = rand() * total;
  for (const item of items) {
    roll -= item.weight;
    if (roll <= 0) return item;
  }
  return items[items.length - 1];
}

/** Hour of day in WIB, from the prototype's traffic curve. */
const HOUR_WEIGHTS = [
  0.12, 0.08, 0.06, 0.05, 0.07, 0.18, 0.45, 0.9, 1.3, 1.5, 1.4, 1.3, 1.35, 1.4, 1.3, 1.2, 1.1,
  1.05, 1.2, 1.5, 1.6, 1.4, 0.9, 0.4,
];

function pickHour(rand) {
  const total = HOUR_WEIGHTS.reduce((sum, weight) => sum + weight, 0);
  let roll = rand() * total;
  for (let hour = 0; hour < 24; hour += 1) {
    roll -= HOUR_WEIGHTS[hour];
    if (roll <= 0) return hour;
  }
  return 12;
}

const NETWORKS = [
  { ip: '36.72.{a}.{b}', asn: 7713, org: 'PT TELKOM INDONESIA', country: 'ID', region: 'Jakarta', city: 'Jakarta', tz: 'Asia/Jakarta', colo: 'CGK', weight: 0.26 },
  { ip: '114.124.{a}.{b}', asn: 23693, org: 'PT Telekomunikasi Selular', country: 'ID', region: 'West Java', city: 'Depok', tz: 'Asia/Jakarta', colo: 'CGK', weight: 0.14 },
  { ip: '180.244.{a}.{b}', asn: 7713, org: 'PT TELKOM INDONESIA', country: 'ID', region: 'West Java', city: 'Bandung', tz: 'Asia/Jakarta', colo: 'CGK', weight: 0.11 },
  { ip: '2001:448a:{x}:{y}::1', asn: 7713, org: 'PT TELKOM INDONESIA', country: 'ID', region: 'East Java', city: 'Surabaya', tz: 'Asia/Jakarta', colo: 'CGK', weight: 0.09 },
  { ip: '114.5.{a}.{b}', asn: 4761, org: 'INDOSAT Internet Network Provider', country: 'ID', region: 'Banten', city: 'Tangerang Selatan', tz: 'Asia/Jakarta', colo: 'CGK', weight: 0.07 },
  { ip: '112.215.{a}.{b}', asn: 24203, org: 'PT XL Axiata', country: 'ID', region: 'Yogyakarta', city: 'Yogyakarta', tz: 'Asia/Jakarta', colo: 'SIN', weight: 0.06 },
  { ip: '2404:c0:{x}:{y}::2', asn: 17451, org: 'BIZNET NETWORKS', country: 'ID', region: 'Jakarta', city: 'Jakarta', tz: 'Asia/Jakarta', colo: 'CGK', weight: 0.06 },
  { ip: '203.117.{a}.{b}', asn: 9506, org: 'Singtel Fibre Broadband', country: 'SG', region: 'Singapore', city: 'Singapore', tz: 'Asia/Singapore', colo: 'SIN', weight: 0.06 },
  { ip: '175.139.{a}.{b}', asn: 4788, org: 'TM TECHNOLOGY SERVICES', country: 'MY', region: 'Kuala Lumpur', city: 'Kuala Lumpur', tz: 'Asia/Kuala_Lumpur', colo: 'KUL', weight: 0.04 },
  { ip: '24.61.{a}.{b}', asn: 7922, org: 'Comcast Cable Communications', country: 'US', region: 'Virginia', city: 'Ashburn', tz: 'America/New_York', colo: 'IAD', weight: 0.04 },
  { ip: '106.130.{a}.{b}', asn: 2516, org: 'KDDI CORPORATION', country: 'JP', region: 'Tokyo', city: 'Tokyo', tz: 'Asia/Tokyo', colo: 'NRT', weight: 0.03 },
  { ip: '2001:983:{x}:{y}::7', asn: 1136, org: 'KPN B.V.', country: 'NL', region: 'North Holland', city: 'Amsterdam', tz: 'Europe/Amsterdam', colo: 'AMS', weight: 0.02 },
  { ip: '145.53.{a}.{b}', asn: 1136, org: 'KPN B.V.', country: 'NL', region: 'North Holland', city: 'Amsterdam', tz: 'Europe/Amsterdam', colo: 'AMS', weight: 0.02 },
];

const BOT_SOURCES = [
  { ip: '157.240.{a}.{b}', asn: 32934, org: 'Facebook, Inc.', country: 'US', region: 'California', city: 'Menlo Park', tz: 'America/Los_Angeles', colo: 'SIN', ua: 'WhatsApp/2.24.17.78 A', weight: 0.38 },
  { ip: '149.154.{a}.{b}', asn: 62041, org: 'Telegram Messenger Inc', country: 'NL', region: 'North Holland', city: 'Amsterdam', tz: 'Europe/Amsterdam', colo: 'AMS', ua: 'TelegramBot (like TwitterBot)', weight: 0.17 },
  { ip: '108.174.{a}.{b}', asn: 14413, org: 'LinkedIn Corporation', country: 'US', region: 'Illinois', city: 'Chicago', tz: 'America/Chicago', colo: 'SIN', ua: 'LinkedInBot/1.0 (compatible; Mozilla/5.0; Apache-HttpClient +http://www.linkedin.com)', weight: 0.16 },
  { ip: '173.252.{a}.{b}', asn: 32934, org: 'Facebook, Inc.', country: 'US', region: 'Virginia', city: 'Ashburn', tz: 'America/New_York', colo: 'SIN', ua: 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)', weight: 0.1 },
  { ip: '2a03:2880:{x}:{y}::face', asn: 32934, org: 'Facebook, Inc.', country: 'IE', region: 'Leinster', city: 'Dublin', tz: 'Europe/Dublin', colo: 'AMS', ua: 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)', weight: 0.02 },
  { ip: '66.249.{a}.{b}', asn: 15169, org: 'Google LLC', country: 'US', region: 'California', city: 'Mountain View', tz: 'America/Los_Angeles', colo: 'SIN', ua: 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)', weight: 0.07 },
  { ip: '199.16.{a}.{b}', asn: 13414, org: 'Twitter Inc.', country: 'US', region: 'California', city: 'San Francisco', tz: 'America/Los_Angeles', colo: 'SIN', ua: 'Twitterbot/1.0', weight: 0.05 },
  { ip: '34.82.{a}.{b}', asn: 15169, org: 'Google LLC', country: 'US', region: 'Oregon', city: 'The Dalles', tz: 'America/Los_Angeles', colo: 'SIN', ua: 'Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)', weight: 0.05 },
];

const HUMAN_UAS = [
  { ua: 'Mozilla/5.0 (Linux; Android 15; SM-S921B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.6668.70 Mobile Safari/537.36', weight: 0.3 },
  { ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1', weight: 0.2 },
  { ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36', weight: 0.16 },
  { ua: 'Mozilla/5.0 (Linux; Android 15; V2352) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36 Instagram 350.0.0.44.106 Android', weight: 0.09 },
  { ua: 'Mozilla/5.0 (Linux; Android 14; SM-A546E) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36', weight: 0.08 },
  { ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15', weight: 0.07 },
  { ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 Edg/129.0.0.0', weight: 0.06 },
  { ua: 'Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0', weight: 0.04 },
];

const REFERRERS = [
  { value: null, weight: 0.41 },
  { value: 'https://www.linkedin.com/', weight: 0.22 },
  { value: 'https://l.instagram.com/', weight: 0.12 },
  { value: 'https://www.google.com/', weight: 0.08 },
  { value: 'https://t.co/', weight: 0.06 },
  { value: 'https://www.reddit.com/', weight: 0.06 },
  { value: 'https://github.com/', weight: 0.05 },
];

/**
 * Ten links covering every status: active with and without tags, active with
 * and without an expiry date, inactive, and expired. `jadwal` deliberately has
 * no clicks so the analytics empty state can be checked, and the last one has a
 * long slug so truncation can be checked. Its title and description also carry
 * a very long unbroken word and a long URL, so wrapping in the QR modal and on
 * the detail page can be checked.
 */
const LINKS = [
  { slug: 'cv', url: 'https://www.linkedin.com/in/daffarestupratama', title: 'CV and LinkedIn profile', description: 'Main link on business cards and email signature.', tags: ['career'], active: true, createdDaysAgo: 199, expiresInDays: null, clicks: 180, spike: { daysAgo: 13, extra: 30, referrer: 'https://www.linkedin.com/' } },
  { slug: 'porto-2026', url: 'https://daffarestupratama.com/portofolio/2026', title: 'Portfolio 2026', description: 'Data analysis and software engineering projects from 2026.', tags: ['career', 'portfolio'], active: true, createdDaysAgo: 265, expiresInDays: 94, clicks: 110, spike: { daysAgo: 55, extra: 20, referrer: 'https://www.kaggle.com/' } },
  { slug: 'wa', url: 'https://wa.me/6281234567890?text=Halo%20Daffa', title: 'WhatsApp contact', description: 'Opens a WhatsApp chat with a greeting message.', tags: ['contact'], active: true, createdDaysAgo: 238, expiresInDays: null, clicks: 80 },
  { slug: 'kaggle', url: 'https://www.kaggle.com/daffarestupratama', title: 'Kaggle profile', description: 'Notebooks and past competitions.', tags: ['data'], active: true, createdDaysAgo: 163, expiresInDays: null, clicks: 45 },
  { slug: 'gh', url: 'https://github.com/daffarestupratama', title: 'GitHub repositories', description: 'Source code for personal projects.', tags: ['code'], active: true, createdDaysAgo: 211, expiresInDays: null, clicks: 50 },
  { slug: 'k7m2qx', url: 'https://docs.google.com/forms/d/e/1FAIpQLSf8wYk2Rm/viewform', title: 'Family gathering RSVP form', description: 'Attendance form for a family gathering.', tags: ['event'], active: true, createdDaysAgo: 27, expiresInDays: -8, clicks: 55 },
  { slug: 'slide-pydata', url: 'https://speakerdeck.com/daffarestupratama/pydata-jakarta-2026', title: 'PyData Jakarta slides', description: 'Talk slides from the PyData Jakarta meetup.', tags: ['event', 'data'], active: false, createdDaysAgo: 129, expiresInDays: null, deactivatedDaysAgo: 18, clicks: 30 },
  { slug: 'resume-en', url: 'https://drive.google.com/file/d/1aB9xZqR7tLmN4/view', title: 'English resume', description: 'PDF for international applications.', tags: ['career'], active: true, createdDaysAgo: 8, expiresInDays: 17, clicks: 22 },
  { slug: 'jadwal', url: 'https://calendar.app.google/Rk2nVx8QpLm', title: 'Schedule a meeting', description: 'Booking page for a 30 minute call.', tags: ['contact'], active: true, createdDaysAgo: 1, expiresInDays: null, clicks: 0 },
  { slug: 'data-workshop-materials-for-the-jakarta-meetup-2026', url: 'https://drive.google.com/drive/folders/1WkSh0pM4t3r14ls', title: 'Data workshop materials JakartaMeetupNotebooksDatasetsAndSlidesArchiveForEveryAttendee2026', description: 'Mirror of WorkshopNotebooksPandasScikitLearnAndVisualizationExercisesWithSolutions at https://drive.google.com/drive/folders/1WkSh0pM4t3r14ls/jakarta-meetup-2026/notebooks-and-datasets?usp=sharing&resourcekey=0-AbCdEfGhIjKlMnOpQrStUv for attendees.', tags: [], active: true, createdDaysAgo: 41, expiresInDays: null, clicks: 28 },
];

/** Start of a WIB calendar day, expressed as an epoch value. */
function wibDayStart(ms) {
  return Math.floor((ms + WIB) / DAY) * DAY - WIB;
}

function fillIp(template, rand) {
  return template
    .replace('{a}', String(Math.floor(rand() * 253) + 1))
    .replace('{b}', String(Math.floor(rand() * 253) + 1))
    .replace('{x}', Math.floor(rand() * 65535).toString(16))
    .replace('{y}', Math.floor(rand() * 65535).toString(16));
}

function buildClicks(link, linkId) {
  if (link.clicks === 0) return [];
  const rand = rng(hash(`${link.slug}:${linkId}`));

  const createdAt = NOW - link.createdDaysAgo * DAY;
  const expiresAt = link.expiresInDays === null ? null : NOW + link.expiresInDays * DAY;
  const deactivatedAt =
    link.deactivatedDaysAgo === undefined ? null : NOW - link.deactivatedDaysAgo * DAY;

  const start = Math.max(createdAt, NOW - WINDOW_DAYS * DAY);
  let end = NOW;
  if (expiresAt !== null) end = Math.min(end, expiresAt);
  if (deactivatedAt !== null) end = Math.min(end, deactivatedAt);
  if (end <= start) return [];

  const rows = [];
  let guard = 0;
  while (rows.length < link.clicks && guard < link.clicks * 60) {
    guard += 1;

    const dayStart = wibDayStart(start + rand() * (end - start));
    const weekday = new Date(dayStart + WIB).getUTCDay();
    // Weekends run quieter, the same damping the prototype used.
    if ((weekday === 0 || weekday === 6) && rand() > 0.67) continue;

    const ts = dayStart + pickHour(rand) * 60 * 60 * 1000 + Math.floor(rand() * 60 * 60 * 1000);
    if (ts < start || ts > end) continue;

    rows.push(clickRow(linkId, ts, rand));
  }

  // One day of extra traffic, like the spikes in the design prototype, so the
  // chart's peak annotation shows on real data. Its own PRNG stream, a fixed
  // day offset and a fixed count keep every run identical.
  if (link.spike) {
    const spikeRand = rng(hash(`${link.slug}:spike`));
    const spikeDay = wibDayStart(NOW - link.spike.daysAgo * DAY);
    for (let i = 0; i < link.spike.extra; i += 1) {
      const ts = spikeDay + pickHour(spikeRand) * 60 * 60 * 1000 + Math.floor(spikeRand() * 60 * 60 * 1000);
      rows.push(clickRow(linkId, ts, spikeRand, link.spike.referrer));
    }
  }
  return rows;
}

function clickRow(linkId, ts, rand, referrerOverride) {
  const isBot = rand() < BOT_SHARE;
  const source = isBot ? weightedPick(BOT_SOURCES, rand) : weightedPick(NETWORKS, rand);
  const ua = isBot ? source.ua : weightedPick(HUMAN_UAS, rand).ua;
  const referrer = isBot ? null : (referrerOverride ?? weightedPick(REFERRERS, rand).value);
  return {
    linkId,
    ts,
    ip: fillIp(source.ip, rand),
    ua,
    isBot: isBot ? 1 : 0,
    country: source.country,
    region: source.region,
    city: source.city,
    tz: source.tz,
    colo: source.colo,
    asn: source.asn,
    org: source.org,
    referrer,
  };
}

const quote = (value) =>
  value === null || value === undefined ? 'NULL' : `'${String(value).replace(/'/g, "''")}'`;

function buildSql() {
  const statements = [
    '-- Generated by scripts/seed.mjs. Local development data only.',
    `-- Generated at ${new Date(NOW).toISOString()}`,
    '',
    'DELETE FROM clicks;',
    'DELETE FROM link_tags;',
    'DELETE FROM tags;',
    'DELETE FROM links;',
    '',
  ];

  const linkValues = LINKS.map((link, index) => {
    const id = index + 1;
    const createdAt = NOW - link.createdDaysAgo * DAY;
    const expiresAt = link.expiresInDays === null ? 'NULL' : String(NOW + link.expiresInDays * DAY);
    const updatedAt = link.deactivatedDaysAgo === undefined ? createdAt : NOW - link.deactivatedDaysAgo * DAY;
    return `(${id}, ${quote(link.slug)}, ${quote(link.url)}, ${quote(link.title)}, ${quote(link.description)}, ${link.active ? 1 : 0}, ${expiresAt}, ${createdAt}, ${updatedAt})`;
  });

  statements.push(
    'INSERT INTO links (id, slug, url, title, description, is_active, expires_at, created_at, updated_at) VALUES',
    `${linkValues.join(',\n')};`,
    '',
  );

  const tagNames = [...new Set(LINKS.flatMap((link) => link.tags))].sort();
  if (tagNames.length > 0) {
    const tagValues = tagNames.map((name, index) => `(${index + 1}, ${quote(name)})`);
    statements.push('INSERT INTO tags (id, name) VALUES', `${tagValues.join(', ')};`, '');

    const pairs = [];
    LINKS.forEach((link, index) => {
      for (const tag of link.tags) {
        pairs.push(`(${index + 1}, ${tagNames.indexOf(tag) + 1})`);
      }
    });
    statements.push('INSERT INTO link_tags (link_id, tag_id) VALUES', `${pairs.join(', ')};`, '');
  }

  const clicks = LINKS.flatMap((link, index) => buildClicks(link, index + 1)).sort(
    (a, b) => a.ts - b.ts,
  );

  const CHUNK = 200;
  for (let offset = 0; offset < clicks.length; offset += CHUNK) {
    const values = clicks.slice(offset, offset + CHUNK).map(
      (row) =>
        `(${row.linkId}, ${row.ts}, ${quote(row.ip)}, ${quote(row.ua)}, ${row.isBot}, ` +
        `${quote(row.country)}, ${quote(row.region)}, ${quote(row.city)}, ${quote(row.tz)}, ` +
        `${quote(row.colo)}, ${row.asn}, ${quote(row.org)}, ${quote(row.referrer)})`,
    );
    statements.push(
      'INSERT INTO clicks (link_id, ts, ip, ua, is_bot, country, region, city, timezone, colo, asn, as_org, referrer) VALUES',
      `${values.join(',\n')};`,
      '',
    );
  }

  return { sql: statements.join('\n'), clicks, tagNames };
}

const { sql, clicks, tagNames } = buildSql();
await writeFile(path.join(ROOT, SQL_FILE), sql, 'utf8');

const bots = clicks.filter((row) => row.isBot === 1).length;
const oldest = clicks.length > 0 ? new Date(clicks[0].ts) : null;
const newest = clicks.length > 0 ? new Date(clicks[clicks.length - 1].ts) : null;

console.log(`Wrote ${SQL_FILE}`);
console.log(`  links    ${LINKS.length}`);
console.log(`  tags     ${tagNames.length} (${tagNames.join(', ')})`);
console.log(
  `  clicks   ${clicks.length} total, ${bots} bot (${Math.round((bots / clicks.length) * 100)} percent)`,
);
if (oldest && newest) {
  console.log(`  span     ${oldest.toISOString().slice(0, 10)} to ${newest.toISOString().slice(0, 10)}`);
}

console.log('\nApplying to the local database.');
const result = spawnSync(
  'npx',
  [
    'wrangler',
    'd1',
    'execute',
    'daffa-links',
    '--local',
    '--persist-to',
    '.wrangler-state',
    '--file',
    SQL_FILE,
    '-c',
    'apps/redirector/wrangler.jsonc',
    '--yes',
  ],
  { cwd: ROOT, stdio: 'inherit', shell: true },
);

if (result.status !== 0) {
  console.error('\nwrangler d1 execute failed. Run `npm run migrate:local` first.');
  process.exit(result.status ?? 1);
}

console.log('\nLocal database seeded.');

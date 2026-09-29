/**
 * A small, purpose built user agent parser. The redirector stores raw user
 * agents and never parses them (10 ms CPU budget), so the dashboard does it in
 * the browser. It only needs the labels the design shows, which keeps it far
 * smaller than a general library. ua-parser-js 2.x is AGPL and not an option.
 */

export type DeviceKind = 'Mobile' | 'Tablet' | 'Desktop' | 'Crawler';

export interface ParsedUserAgent {
  device: DeviceKind;
  /** "Chrome", "Safari", "Instagram", or the bot name for crawlers. */
  browser: string;
  browserVersion: string | null;
  /** Browser grouping for the BROWSER ranking: in-app browsers fold into one row. */
  browserFamily: string;
  os: string;
  osVersion: string | null;
  /** Bot name when the click was classified as a bot, otherwise null. */
  bot: string | null;
}

/** Order matters: TelegramBot calls itself "like TwitterBot". */
const BOTS: ReadonlyArray<[RegExp, string]> = [
  [/WhatsApp/i, 'WhatsApp'],
  [/TelegramBot/i, 'TelegramBot'],
  [/LinkedInBot/i, 'LinkedInBot'],
  [/facebookexternalhit|facebookcatalog|meta-externalagent/i, 'facebookexternalhit'],
  [/Googlebot|Google-InspectionTool/i, 'Googlebot'],
  [/Twitterbot/i, 'Twitterbot'],
  [/Slackbot/i, 'Slackbot'],
  [/Discordbot/i, 'Discordbot'],
  [/bingbot/i, 'Bingbot'],
  [/Applebot/i, 'Applebot'],
  [/YandexBot/i, 'YandexBot'],
  [/HeadlessChrome/i, 'HeadlessChrome'],
  [/^curl\//i, 'curl'],
  [/python-requests/i, 'python-requests'],
];

const IN_APP: ReadonlyArray<[RegExp, string]> = [
  [/Instagram/, 'Instagram'],
  [/FBAN|FBAV|FB_IAB/, 'Facebook'],
  [/\bLine\//, 'LINE'],
  [/TikTok|musical_ly|BytedanceWebview/, 'TikTok'],
];

/** The design shows versions for these browsers only, for example "Chrome 129". */
const VERSIONED: ReadonlyArray<[RegExp, string]> = [
  [/Edg(?:e|A|iOS)?\/(\d+)/, 'Edge'],
  [/OPR\/(\d+)/, 'Opera'],
];

export const IN_APP_FAMILY = 'In-app browser';

function detectOs(ua: string): { os: string; osVersion: string | null } {
  const ios = /(?:iPhone|iPad|iPod).*? OS (\d+)[_\d]*/.exec(ua);
  if (ios) return { os: 'iOS', osVersion: ios[1] ?? null };
  const android = /Android (\d+)/.exec(ua);
  if (android) return { os: 'Android', osVersion: android[1] ?? null };
  if (/Android/.test(ua)) return { os: 'Android', osVersion: null };
  // Windows 10 and 11 both report "Windows NT 10.0", so no version is shown.
  if (/Windows NT|Windows Phone/.test(ua)) return { os: 'Windows', osVersion: null };
  if (/CrOS/.test(ua)) return { os: 'ChromeOS', osVersion: null };
  // macOS froze its reported version at 10_15_7, so none is shown.
  if (/Mac OS X|Macintosh/.test(ua)) return { os: 'macOS', osVersion: null };
  if (/Linux/.test(ua)) return { os: 'Linux', osVersion: null };
  return { os: 'Other', osVersion: null };
}

function detectDevice(ua: string): DeviceKind {
  if (/iPad|Tablet/.test(ua)) return 'Tablet';
  if (/Android/.test(ua) && !/Mobile/.test(ua)) return 'Tablet';
  if (/Mobi|iPhone|iPod|Android/.test(ua)) return 'Mobile';
  return 'Desktop';
}

function detectBrowser(ua: string): { browser: string; browserVersion: string | null; inApp: boolean } {
  for (const [pattern, name] of IN_APP) {
    if (pattern.test(ua)) return { browser: name, browserVersion: null, inApp: true };
  }
  for (const [pattern, name] of VERSIONED) {
    const match = pattern.exec(ua);
    if (match) return { browser: name, browserVersion: match[1] ?? null, inApp: false };
  }
  if (/SamsungBrowser\//.test(ua)) return { browser: 'Samsung Internet', browserVersion: null, inApp: false };
  const firefox = /(?:Firefox|FxiOS)\/(\d+)/.exec(ua);
  if (firefox) return { browser: 'Firefox', browserVersion: firefox[1] ?? null, inApp: false };
  const chrome = /(?:Chrome|CriOS)\/(\d+)/.exec(ua);
  if (chrome) return { browser: 'Chrome', browserVersion: chrome[1] ?? null, inApp: false };
  if (/Version\/[\d.]+.*Safari/.test(ua)) return { browser: 'Safari', browserVersion: null, inApp: false };
  return { browser: 'Other', browserVersion: null, inApp: false };
}

export function botName(ua: string): string {
  for (const [pattern, name] of BOTS) {
    if (pattern.test(ua)) return name;
  }
  return 'Other';
}

/**
 * `isBot` comes from the server, which classified the click with the same
 * regex the redirector used. The parser only names the bot.
 */
export function parseUserAgent(ua: string, isBot: boolean): ParsedUserAgent {
  const { os, osVersion } = detectOs(ua);
  if (isBot) {
    const name = botName(ua);
    return { device: 'Crawler', browser: name, browserVersion: null, browserFamily: name, os, osVersion, bot: name };
  }
  const { browser, browserVersion, inApp } = detectBrowser(ua);
  return {
    device: detectDevice(ua),
    browser,
    browserVersion,
    browserFamily: inApp ? IN_APP_FAMILY : browser,
    os,
    osVersion,
    bot: null,
  };
}

/** The second line of the DEVICE column: "Chrome 129 · Android 15", "Safari · macOS". */
export function describeBrowser(parsed: ParsedUserAgent): string {
  if (parsed.bot) return parsed.bot;
  const browser = parsed.browserVersion ? `${parsed.browser} ${parsed.browserVersion}` : parsed.browser;
  const os = parsed.osVersion ? `${parsed.os} ${parsed.osVersion}` : parsed.os;
  return `${browser} · ${os}`;
}

export type UaDimension = 'device' | 'browser' | 'os' | 'bot';

/**
 * Parses grouped user agents from the API and re-groups them by one
 * dimension, largest first. The API returns at most a few hundred distinct
 * strings per range, so this stays cheap.
 */
export function aggregateUserAgents(
  rows: ReadonlyArray<{ ua: string; count: number }>,
  dimension: UaDimension,
  isBot: boolean,
): { label: string; count: number }[] {
  const totals = new Map<string, number>();
  for (const row of rows) {
    const parsed = parseUserAgent(row.ua, isBot);
    const label =
      dimension === 'device'
        ? parsed.device
        : dimension === 'browser'
          ? parsed.browserFamily
          : dimension === 'os'
            ? parsed.os
            : (parsed.bot ?? 'Other');
    totals.set(label, (totals.get(label) ?? 0) + row.count);
  }
  return [...totals.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

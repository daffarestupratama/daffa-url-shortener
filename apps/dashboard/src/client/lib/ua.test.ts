import { describe, expect, it } from 'vitest';
import { IN_APP_FAMILY, aggregateUserAgents, describeBrowser, parseUserAgent } from './ua';

/** The user agents in scripts/seed.mjs, with the labels the design shows for each. */
const HUMANS: Array<[string, string, string, string]> = [
  [
    'Mozilla/5.0 (Linux; Android 15; SM-S921B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.6668.70 Mobile Safari/537.36',
    'Mobile',
    'Chrome 129 · Android 15',
    'Chrome',
  ],
  [
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
    'Mobile',
    'Safari · iOS 18',
    'Safari',
  ],
  [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
    'Desktop',
    'Chrome 129 · Windows',
    'Chrome',
  ],
  [
    'Mozilla/5.0 (Linux; Android 15; V2352) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36 Instagram 350.0.0.44.106 Android',
    'Mobile',
    'Instagram · Android 15',
    IN_APP_FAMILY,
  ],
  [
    'Mozilla/5.0 (Linux; Android 14; SM-A546E) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36',
    'Mobile',
    'Samsung Internet · Android 14',
    'Samsung Internet',
  ],
  [
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15',
    'Desktop',
    'Safari · macOS',
    'Safari',
  ],
  [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 Edg/129.0.0.0',
    'Desktop',
    'Edge 129 · Windows',
    'Edge',
  ],
  ['Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0', 'Desktop', 'Firefox 131 · Linux', 'Firefox'],
  [
    'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/129.0 Mobile/15E148 Safari/604.1',
    'Tablet',
    'Chrome 129 · iOS 17',
    'Chrome',
  ],
];

describe('parseUserAgent for people', () => {
  for (const [ua, device, label, family] of HUMANS) {
    it(label, () => {
      const parsed = parseUserAgent(ua, false);
      expect(parsed.device).toBe(device);
      expect(describeBrowser(parsed)).toBe(label);
      expect(parsed.browserFamily).toBe(family);
      expect(parsed.bot).toBeNull();
    });
  }

  it('treats an Android device without "Mobile" as a tablet', () => {
    const ua = 'Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36';
    expect(parseUserAgent(ua, false).device).toBe('Tablet');
  });

  it('falls back to Other for something unknown', () => {
    const parsed = parseUserAgent('SomethingElse/1.0', false);
    expect(parsed.browser).toBe('Other');
    expect(parsed.os).toBe('Other');
  });
});

describe('parseUserAgent for bots', () => {
  const BOTS: Array<[string, string]> = [
    ['WhatsApp/2.24.17.78 A', 'WhatsApp'],
    ['TelegramBot (like TwitterBot)', 'TelegramBot'],
    ['LinkedInBot/1.0 (compatible; Mozilla/5.0; Apache-HttpClient +http://www.linkedin.com)', 'LinkedInBot'],
    ['facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)', 'facebookexternalhit'],
    ['Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)', 'Googlebot'],
    ['Twitterbot/1.0', 'Twitterbot'],
    ['Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)', 'Slackbot'],
    ['curl/8.4.0', 'curl'],
    ['SomeCrawler/3.0', 'Other'],
  ];
  for (const [ua, name] of BOTS) {
    it(name, () => {
      const parsed = parseUserAgent(ua, true);
      expect(parsed.bot).toBe(name);
      expect(parsed.device).toBe('Crawler');
      expect(describeBrowser(parsed)).toBe(name);
    });
  }

  it('names TelegramBot before Twitterbot, although it says "like TwitterBot"', () => {
    expect(parseUserAgent('TelegramBot (like TwitterBot)', true).bot).toBe('TelegramBot');
  });
});

describe('aggregateUserAgents', () => {
  const rows = HUMANS.map(([ua], i) => ({ ua, count: i + 1 }));

  it('groups by browser family, folding in-app browsers together', () => {
    const browsers = aggregateUserAgents(rows, 'browser', false);
    const total = browsers.reduce((sum, row) => sum + row.count, 0);
    expect(total).toBe(rows.reduce((sum, row) => sum + row.count, 0));
    expect(browsers.map((row) => row.label)).toContain(IN_APP_FAMILY);
    expect(browsers.map((row) => row.label)).not.toContain('Instagram');
  });

  it('sorts largest first', () => {
    const devices = aggregateUserAgents(rows, 'device', false);
    const counts = devices.map((row) => row.count);
    expect(counts).toEqual([...counts].sort((a, b) => b - a));
  });
});

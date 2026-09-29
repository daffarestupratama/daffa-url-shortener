import { describe, expect, it } from 'vitest';
import { isBotUserAgent } from './bot';

/** The preview fetchers the design names in its BOT CLICKS panel. */
const BOTS = [
  'WhatsApp/2.24.17.78 A',
  'TelegramBot (like TwitterBot)',
  'LinkedInBot/1.0 (compatible; Mozilla/5.0; Apache-HttpClient +http://www.linkedin.com)',
  'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
  'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
  'Twitterbot/1.0',
  'Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)',
  'Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)',
  'Mozilla/5.0 (compatible; YandexBot/3.0)',
  'curl/8.4.0',
  'python-requests/2.32.3',
  'Go-http-client/2.0',
  'Mozilla/5.0 (X11; Linux x86_64) HeadlessChrome/129.0.0.0',
];

/** Real browser strings matching the devices the design lists in its click log. */
const HUMANS = [
  'Mozilla/5.0 (Linux; Android 15; SM-S921B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.6668.70 Mobile Safari/537.36',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Linux; Android 14; SM-A546E) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 Edg/129.0.0.0',
];

describe('isBotUserAgent', () => {
  it('flags every preview fetcher and scripted client', () => {
    for (const ua of BOTS) {
      expect(isBotUserAgent(ua), ua).toBe(true);
    }
  });

  it('leaves real browsers alone', () => {
    for (const ua of HUMANS) {
      expect(isBotUserAgent(ua), ua).toBe(false);
    }
  });

  it('treats a missing user agent as a bot', () => {
    expect(isBotUserAgent('')).toBe(true);
  });

  it('is stateless across calls', () => {
    const ua = 'Twitterbot/1.0';
    expect(isBotUserAgent(ua)).toBe(true);
    expect(isBotUserAgent(ua)).toBe(true);
    expect(isBotUserAgent(ua)).toBe(true);
  });
});

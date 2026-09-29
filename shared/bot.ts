/**
 * One regex, evaluated once per redirect. This is a substring test, not user
 * agent parsing: the CPU budget on the redirect path is 10 ms, so the detailed
 * bot name, device, browser and operating system are all derived in the browser
 * from the raw user agent stored alongside each click.
 *
 * Covers the preview fetchers the design calls out (WhatsApp, TelegramBot,
 * LinkedInBot, facebookexternalhit, Googlebot, Twitterbot, Slackbot) plus the
 * usual search crawlers, SEO tools and scripted clients.
 */
export const BOT_UA_RE =
  /(bot|crawl|spider|slurp|preview|facebookexternalhit|whatsapp|telegram|discord|slack|twitter|linkedin|embedly|pinterest|yandex|semrush|ahrefs|headless|phantomjs|python-requests|node-fetch|go-http-client|okhttp|libwww|curl|wget|monitoring|uptime|validator)/i;

/**
 * An empty user agent counts as a bot. Real browsers always send one, so a
 * missing header means a scripted client.
 */
export function isBotUserAgent(ua: string): boolean {
  if (!ua) return true;
  return BOT_UA_RE.test(ua);
}

import { isBotUserAgent } from '@daffa/shared';

/**
 * The subset of request.cf the click log stores. Cloudflare fills these in
 * before the Worker runs, so reading them costs no CPU.
 */
interface CfProperties {
  country?: string | null;
  region?: string | null;
  city?: string | null;
  timezone?: string | null;
  colo?: string | null;
  asn?: number | null;
  asOrganization?: string | null;
}

const INSERT = `INSERT INTO clicks
  (link_id, ts, ip, ua, is_bot, country, region, city, timezone, colo, asn, as_org, referrer)
  VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)`;

/**
 * Records one served redirect. Called through ctx.waitUntil after the response
 * has already been returned, so it never delays the visitor.
 *
 * The user agent is stored raw. Everything that needs parsing (device, browser,
 * operating system, the specific bot name) is derived in the browser, because
 * the redirect path has a 10 ms CPU budget. The only inspection here is the
 * single is_bot regex test.
 */
export async function logClick(
  db: D1Database,
  request: Request,
  linkId: number,
): Promise<void> {
  try {
    const cf = (request as Request & { cf?: CfProperties }).cf;
    const ua = request.headers.get('user-agent') ?? '';
    const ip = request.headers.get('cf-connecting-ip') ?? '';
    const referrer = request.headers.get('referer');

    await db
      .prepare(INSERT)
      .bind(
        linkId,
        Date.now(),
        ip,
        ua,
        isBotUserAgent(ua) ? 1 : 0,
        cf?.country ?? null,
        cf?.region ?? null,
        cf?.city ?? null,
        cf?.timezone ?? null,
        cf?.colo ?? null,
        cf?.asn ?? null,
        cf?.asOrganization ?? null,
        referrer ?? null,
      )
      .run();
  } catch (error) {
    // A failed log must never affect the redirect the visitor already received.
    console.error('click log failed', error);
  }
}

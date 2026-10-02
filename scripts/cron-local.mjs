/**
 * Fires the dashboard Worker's daily cron once, against `npm run dev`. The
 * Cloudflare Vite plugin exposes the scheduled handler of the local Worker at
 * /cdn-cgi/local/scheduled. Only the local database is touched. The purge
 * counts are logged by the Worker, in the npm run dev output.
 *
 *   npm run cron:local
 *   CRON_DASHBOARD  default http://localhost:5173
 *
 * The same request with curl:
 *   curl "http://localhost:5173/cdn-cgi/local/scheduled?cron=15+0+*+*+*"
 */

const DASHBOARD = process.env.CRON_DASHBOARD ?? 'http://localhost:5173';

try {
  const response = await fetch(`${DASHBOARD}/cdn-cgi/local/scheduled?cron=15+0+*+*+*`);
  const body = (await response.text()).trim();
  console.log(`Scheduled handler answered ${response.status}: ${body || '(empty body)'}`);
  console.log('The purge counts are in the npm run dev output.');
  process.exitCode = response.ok ? 0 : 1;
} catch (error) {
  console.error(`The dashboard is not reachable at ${DASHBOARD}. Start it with \`npm run dev\`.`);
  console.error(String(error));
  process.exitCode = 1;
}

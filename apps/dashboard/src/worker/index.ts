import { Hono, type MiddlewareHandler } from 'hono';
import { createAuthMiddleware } from './auth';
import { scheduled } from './cron';
import { csrfMiddleware } from './csrf';
import type { AppEnv, Env } from './env';
import { errorResponse, handleError } from './errors';
import { analyticsRoutes } from './routes/analytics';
import { blockedRoutes } from './routes/blocked';
import { linkRoutes } from './routes/links';
import { meRoutes } from './routes/me';
import { publicRoutes } from './routes/public';
import { publicLinkRoutes } from './routes/publicLinks';
import { slugRoutes } from './routes/slugs';
import { summaryRoutes } from './routes/summary';
import { tagRoutes } from './routes/tags';
import { jsonBodyLimit, publicBodyLimit } from './validate';

/**
 * The API on link.daffa.me. With run_worker_first set to /api/*, this Worker
 * only ever sees API requests. Every other path is served straight from the
 * static assets, with index.html as the SPA fallback for / and /dashboard.
 *
 *   /api/admin/*   the owner. Cloudflare Access in front, and the Access JWT
 *                  verified here on every request as well.
 *   /api/public/*  anonymous visitors of the public page. No Access, so each
 *                  route defends itself (see routes/public.ts).
 *
 * Order matters: identity first, then the CSRF check on state changing
 * requests, then the body size limit, then the route itself. An unknown path
 * under /api/admin still passes through Access verification before its 404.
 */
const app = new Hono<AppEnv>().basePath('/api');

/** API answers are personal or one off, so nothing is cached and nothing is indexed. */
const apiHeaders: MiddlewareHandler<AppEnv> = async (c, next) => {
  await next();
  c.header('Cache-Control', 'no-store');
  c.header('X-Robots-Tag', 'noindex');
};

app.onError(handleError);
app.notFound((c) => errorResponse(c, 'not_found'));

app.use('*', apiHeaders);

app.use('/admin/*', createAuthMiddleware());
app.use('/admin/*', csrfMiddleware);
app.use('/admin/*', jsonBodyLimit);

const admin = new Hono<AppEnv>()
  .route('/', meRoutes)
  .route('/', summaryRoutes)
  .route('/', linkRoutes)
  .route('/', analyticsRoutes)
  .route('/', slugRoutes)
  .route('/', tagRoutes)
  .route('/', publicLinkRoutes)
  .route('/', blockedRoutes);
app.route('/admin', admin);

app.use('/public/*', csrfMiddleware);
app.use('/public/*', publicBodyLimit);
app.route('/public', publicRoutes);

export default {
  fetch: app.fetch,
  scheduled,
} satisfies ExportedHandler<Env>;

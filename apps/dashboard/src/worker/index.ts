import { Hono } from 'hono';
import { createAuthMiddleware } from './auth';
import { csrfMiddleware } from './csrf';
import type { AppEnv } from './env';
import { errorResponse, handleError } from './errors';
import { analyticsRoutes } from './routes/analytics';
import { linkRoutes } from './routes/links';
import { meRoutes } from './routes/me';
import { slugRoutes } from './routes/slugs';
import { summaryRoutes } from './routes/summary';
import { tagRoutes } from './routes/tags';
import { jsonBodyLimit } from './validate';

/**
 * The dashboard API. With run_worker_first set to /api/*, this Worker only
 * ever sees API requests. Every other path is served straight from the static
 * assets, with index.html as the SPA fallback.
 *
 * Order matters: identity first, then the CSRF check on state changing
 * requests, then the body size limit, then the route itself.
 */
const app = new Hono<AppEnv>().basePath('/api');

app.onError(handleError);
app.notFound((c) => errorResponse(c, 'not_found'));

app.use('*', createAuthMiddleware());
app.use('*', csrfMiddleware);
app.use('*', jsonBodyLimit);

app.route('/', meRoutes);
app.route('/', summaryRoutes);
app.route('/', linkRoutes);
app.route('/', analyticsRoutes);
app.route('/', slugRoutes);
app.route('/', tagRoutes);

export default app;

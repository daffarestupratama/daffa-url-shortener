import { Hono } from 'hono';
import type { AppEnv } from '../env';

/** The signed in identity, for the header. No database access. */
export const meRoutes = new Hono<AppEnv>().get('/me', (c) => c.json({ email: c.get('email') }));

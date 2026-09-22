import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import { HttpError, notFound } from './lib/http.js';
import { clustersRouter } from './routes/clusters.js';
import { ingestRouter } from './routes/ingest.js';
import { timelineRouter } from './routes/timeline.js';

/** "https://*.vercel.app" style wildcards are allowed in CORS_ORIGINS. */
function originMatcher(patterns) {
  const regexes = patterns.map((p) =>
    p === '*' ? /.*/ : new RegExp(`^${p.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^.]+')}$`),
  );
  return (origin) => !origin || regexes.some((r) => r.test(origin));
}

export function createApp({ config, db, jobs }) {
  const app = express();
  const allowed = originMatcher(config.corsOrigins);

  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(
    cors({
      origin: (origin, cb) => cb(null, allowed(origin)),
      methods: ['GET', 'POST', 'OPTIONS'],
      maxAge: 600,
    }),
  );
  app.use(express.json({ limit: '10kb' }));
  if (config.logRequests) app.use(morgan('tiny'));
  app.use(rateLimit({ windowMs: 60_000, limit: 600, standardHeaders: 'draft-7', legacyHeaders: false }));

  app.get('/', (_req, res) => {
    res.json({
      name: 'News Pulse API',
      endpoints: [
        'GET  /health',
        'GET  /clusters?minArticles=&sources=&from=&to=&sort=recent|size|oldest&limit=&offset=',
        'GET  /clusters/:id',
        'GET  /timeline?hours=72&sources=&minArticles=2&limit=200',
        'GET  /sources',
        'POST /ingest/trigger',
        'GET  /ingest/status/:jobId',
      ],
    });
  });

  app.get('/health', async (_req, res) => {
    try {
      await db.query('SELECT 1 AS ok');
      res.json({ status: 'ok', database: db.dialect, uptimeSeconds: Math.round(process.uptime()) });
    } catch (err) {
      res.status(503).json({ status: 'error', database: db.dialect, message: err.message });
    }
  });

  app.use(clustersRouter({ db }));
  app.use(timelineRouter({ db }));
  app.use(ingestRouter({ jobs, config }));

  app.use((req, _res, next) => next(notFound(`No route for ${req.method} ${req.path}`)));

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err.type === 'entity.parse.failed') err = new HttpError(400, 'Request body is not valid JSON', 'bad_request');
    if (err instanceof HttpError) {
      if (err.extra?.retryAfterSeconds) res.set('Retry-After', String(err.extra.retryAfterSeconds));
      return res.status(err.status).json({ error: { code: err.code, message: err.message, ...err.extra } });
    }
    console.error('[error]', err);
    return res.status(500).json({ error: { code: 'internal_error', message: 'Something went wrong on the server.' } });
  });

  return app;
}

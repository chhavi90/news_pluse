import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { asyncHandler, notFound, badRequest } from '../lib/http.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function ingestRouter({ jobs, config }) {
  const router = Router();
  const limiter = rateLimit({
    windowMs: 60_000,
    limit: config.ingestRatePerMinute,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (_req, res) =>
      res.status(429).json({ error: { code: 'rate_limited', message: 'Too many refresh requests. Please wait a minute.' } }),
  });

  // POST /ingest/trigger -> 202 { jobId, status, ... }  (starts `python -m scraper.run`)
  router.post(
    '/ingest/trigger',
    limiter,
    asyncHandler(async (_req, res) => {
      const { job, reused } = await jobs.trigger();
      res.status(202).json({ ...job, alreadyRunning: reused });
    }),
  );

  // GET /ingest/status/:jobId
  router.get(
    '/ingest/status/:jobId',
    asyncHandler(async (req, res) => {
      if (!UUID.test(req.params.jobId)) throw badRequest('"jobId" must be a UUID');
      const job = await jobs.getJob(req.params.jobId.toLowerCase());
      if (!job) throw notFound(`Job ${req.params.jobId} does not exist`);
      res.set('Cache-Control', 'no-store');
      res.json(job);
    }),
  );

  return router;
}

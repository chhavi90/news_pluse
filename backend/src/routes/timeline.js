import { Router } from 'express';
import { asyncHandler, badRequest, dateParam, intParam, listParam } from '../lib/http.js';
import { listClusters, windowStats } from '../services/clusters.js';

export function timelineRouter({ db }) {
  const router = Router();

  /**
   * GET /timeline?hours=72&sources=BBC%20News,NPR&minArticles=2&limit=200
   *
   * Shaped for a charting library: every cluster is an interval (start -> end) plus a size metric.
   *   intensity = articleCount / largest cluster in the response  (0..1, for bar height / opacity)
   */
  router.get(
    '/timeline',
    asyncHandler(async (req, res) => {
      const now = new Date();
      const hours = intParam(req.query.hours, 'hours', { min: 1, max: 24 * 30, fallback: 72 });
      const to = dateParam(req.query.to, 'to') ?? now;
      const from = dateParam(req.query.from, 'from') ?? new Date(to.getTime() - hours * 3600 * 1000);
      if (from > to) throw badRequest('"from" must not be after "to"');
      const sources = listParam(req.query.sources, 'sources');
      const minArticles = intParam(req.query.minArticles, 'minArticles', { min: 1, max: 1000, fallback: 2 });
      const limit = intParam(req.query.limit, 'limit', { min: 1, max: 500, fallback: 200 });

      const [{ total, items }, stats] = await Promise.all([
        listClusters(db, { sources, from, to, minArticles, sort: 'size', limit, offset: 0 }),
        windowStats(db, { sources, from, to }),
      ]);
      const maxCount = items.reduce((m, c) => Math.max(m, c.articleCount), 0) || 1;
      const clusters = items
        .map((c) => ({ ...c, intensity: Number((c.articleCount / maxCount).toFixed(3)) }))
        .sort((a, b) => new Date(a.start) - new Date(b.start) || a.id - b.id);

      res.set('Cache-Control', 'no-store');
      res.json({
        meta: {
          generatedAt: now.toISOString(),
          from: from.toISOString(),
          to: to.toISOString(),
          windowHours: hours,
          totalClusters: total,
          returned: clusters.length,
          maxArticleCount: maxCount,
          ...stats,
        },
        clusters,
      });
    }),
  );

  return router;
}

import { Router } from 'express';
import { asyncHandler, badRequest, dateParam, enumParam, idParam, intParam, listParam, notFound } from '../lib/http.js';
import { getClusterDetail, listClusters, listSources, SORT_KEYS } from '../services/clusters.js';

export function clustersRouter({ db }) {
  const router = Router();

  // GET /clusters?minArticles=2&sources=BBC%20News,NPR&from=...&to=...&sort=recent&limit=50&offset=0
  router.get(
    '/clusters',
    asyncHandler(async (req, res) => {
      const from = dateParam(req.query.from, 'from');
      const to = dateParam(req.query.to, 'to');
      if (from && to && from > to) throw badRequest('"from" must not be after "to"');
      const options = {
        sources: listParam(req.query.sources, 'sources'),
        from,
        to,
        minArticles: intParam(req.query.minArticles, 'minArticles', { min: 1, max: 1000, fallback: 1 }),
        sort: enumParam(req.query.sort, 'sort', SORT_KEYS, 'recent'),
        limit: intParam(req.query.limit, 'limit', { min: 1, max: 500, fallback: 100 }),
        offset: intParam(req.query.offset, 'offset', { min: 0, max: 1_000_000, fallback: 0 }),
      };
      const { total, items } = await listClusters(db, options);
      res.json({
        total,
        limit: options.limit,
        offset: options.offset,
        clusters: items.map((c) => ({
          id: c.id,
          label: c.label,
          keywords: c.keywords,
          representativeTitle: c.representativeTitle,
          articleCount: c.articleCount,
          sourceCount: c.sourceCount,
          timeRange: { start: c.start, end: c.end },
        })),
      });
    }),
  );

  // GET /clusters/:id  - the cluster with every article, oldest first
  router.get(
    '/clusters/:id',
    asyncHandler(async (req, res) => {
      const id = idParam(req.params.id);
      const sources = listParam(req.query.sources, 'sources');
      const detail = await getClusterDetail(db, id, { sources });
      if (!detail) throw notFound(`Cluster ${id} does not exist`);
      res.json(detail);
    }),
  );

  // GET /sources - outlets available for the filter UI
  router.get(
    '/sources',
    asyncHandler(async (_req, res) => {
      res.json({ sources: await listSources(db) });
    }),
  );

  return router;
}

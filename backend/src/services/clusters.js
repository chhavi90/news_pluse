import { toDbTime, toIso } from '../lib/time.js';

const SORTS = {
  recent: 'MAX(published_at) DESC',
  size: 'COUNT(*) DESC, MAX(published_at) DESC',
  oldest: 'MIN(published_at) ASC',
};
export const SORT_KEYS = Object.keys(SORTS);

const placeholders = (n) => Array.from({ length: n }, () => '?').join(',');

function parseKeywords(raw) {
  try {
    const value = JSON.parse(raw || '[]');
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

/** Build the WHERE clause shared by every aggregate query (source + time-window filters). */
function articleFilter({ sources = [], from, to }) {
  const where = ['cluster_id IS NOT NULL'];
  const params = [];
  if (sources.length) {
    where.push(`source IN (${placeholders(sources.length)})`);
    params.push(...sources);
  }
  if (from) {
    where.push('published_at >= ?');
    params.push(toDbTime(from));
  }
  if (to) {
    where.push('published_at <= ?');
    params.push(toDbTime(to));
  }
  return { sql: where.join(' AND '), params };
}

/**
 * Cluster summaries computed live from the articles table, so every number (count, time range,
 * outlets) always reflects the active source / time filters.
 */
export async function listClusters(db, { sources = [], from, to, minArticles = 1, sort = 'recent', limit = 100, offset = 0 }) {
  const filter = articleFilter({ sources, from, to });
  const base =
    `SELECT cluster_id AS id, COUNT(*) AS article_count, COUNT(DISTINCT source) AS source_count,
            MIN(published_at) AS start_time, MAX(published_at) AS end_time, COUNT(DISTINCT story_id) AS story_count
       FROM articles WHERE ${filter.sql} GROUP BY cluster_id HAVING COUNT(*) >= ?`;
  const baseParams = [...filter.params, minArticles];

  const [{ total }] = await db.query(`SELECT COUNT(*) AS total FROM (${base}) AS t`, baseParams);
  const rows = await db.query(`${base} ORDER BY ${SORTS[sort]}, cluster_id DESC LIMIT ? OFFSET ?`, [
    ...baseParams,
    limit,
    offset,
  ]);
  if (!rows.length) return { total, items: [] };

  const ids = rows.map((r) => r.id);
  const [labels, perSource] = await Promise.all([
    db.query(`SELECT id, label, keywords, representative_title FROM clusters WHERE id IN (${placeholders(ids.length)})`, ids),
    db.query(
      `SELECT cluster_id, source, COUNT(*) AS n FROM articles
        WHERE ${filter.sql} AND cluster_id IN (${placeholders(ids.length)})
        GROUP BY cluster_id, source ORDER BY n DESC, source ASC`,
      [...filter.params, ...ids],
    ),
  ]);
  const labelById = new Map(labels.map((l) => [l.id, l]));
  const sourcesById = new Map();
  for (const row of perSource) {
    if (!sourcesById.has(row.cluster_id)) sourcesById.set(row.cluster_id, []);
    sourcesById.get(row.cluster_id).push({ name: row.source, count: row.n });
  }

  const items = rows.map((r) => {
    const meta = labelById.get(r.id);
    const start = toIso(r.start_time);
    const end = toIso(r.end_time);
    return {
      id: r.id,
      label: meta?.label ?? `Topic #${r.id}`,
      keywords: parseKeywords(meta?.keywords),
      representativeTitle: meta?.representative_title ?? '',
      articleCount: r.article_count,
      sourceCount: r.source_count,
      sources: sourcesById.get(r.id) ?? [],
      crossSourceStories: r.story_count,
      start,
      end,
      durationMinutes: Math.round((new Date(end) - new Date(start)) / 60000),
    };
  });
  return { total, items };
}

/** Full detail of one cluster with its articles in chronological order. */
export async function getClusterDetail(db, id, { sources = [] } = {}) {
  const [cluster] = await db.query(
    'SELECT id, label, keywords, representative_title, method, updated_at FROM clusters WHERE id = ?',
    [id],
  );
  if (!cluster) return null;

  const params = [id];
  let sourceSql = '';
  if (sources.length) {
    sourceSql = ` AND source IN (${placeholders(sources.length)})`;
    params.push(...sources);
  }
  const articles = await db.query(
    `SELECT id, source, title, summary, url, published_at, published_estimated, content_status, story_id
       FROM articles WHERE cluster_id = ?${sourceSql} ORDER BY published_at ASC, id ASC`,
    params,
  );

  // Cross-outlet stories: which outlets covered the same event, and where else it appears.
  const storyIds = [...new Set(articles.map((a) => a.story_id).filter((s) => s !== null))];
  let stories = [];
  if (storyIds.length) {
    const rows = await db.query(
      `SELECT story_id, source, cluster_id, COUNT(*) AS n FROM articles
        WHERE story_id IN (${placeholders(storyIds.length)}) GROUP BY story_id, source, cluster_id`,
      storyIds,
    );
    const byStory = new Map();
    for (const r of rows) {
      const s = byStory.get(r.story_id) ?? { id: r.story_id, sources: new Set(), clusterIds: new Set(), articleCount: 0 };
      s.sources.add(r.source);
      s.clusterIds.add(r.cluster_id);
      s.articleCount += r.n;
      byStory.set(r.story_id, s);
    }
    stories = [...byStory.values()].map((s) => ({
      id: s.id,
      sources: [...s.sources].sort(),
      articleCount: s.articleCount,
      alsoInClusters: [...s.clusterIds].filter((c) => c !== id).sort((a, b) => a - b),
    }));
  }

  const counts = new Map();
  for (const a of articles) counts.set(a.source, (counts.get(a.source) ?? 0) + 1);

  return {
    id: cluster.id,
    label: cluster.label,
    keywords: parseKeywords(cluster.keywords),
    representativeTitle: cluster.representative_title,
    method: cluster.method,
    updatedAt: toIso(cluster.updated_at),
    articleCount: articles.length,
    sourceCount: counts.size,
    sources: [...counts.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
    start: articles.length ? toIso(articles[0].published_at) : null,
    end: articles.length ? toIso(articles[articles.length - 1].published_at) : null,
    stories,
    articles: articles.map((a) => ({
      id: a.id,
      source: a.source,
      title: a.title,
      summary: a.summary,
      url: a.url,
      publishedAt: toIso(a.published_at),
      publishedEstimated: Boolean(a.published_estimated),
      contentStatus: a.content_status,
      storyId: a.story_id,
    })),
  };
}

export async function listSources(db) {
  const rows = await db.query(
    'SELECT source AS name, COUNT(*) AS article_count, MAX(published_at) AS latest FROM articles GROUP BY source ORDER BY article_count DESC, source ASC',
  );
  return rows.map((r) => ({ name: r.name, articleCount: r.article_count, latestPublishedAt: toIso(r.latest) }));
}

/** Small numbers shown in the UI header (window totals + when data last changed). */
export async function windowStats(db, { sources = [], from, to }) {
  const where = ['1=1'];
  const params = [];
  if (sources.length) {
    where.push(`source IN (${placeholders(sources.length)})`);
    params.push(...sources);
  }
  if (from) {
    where.push('published_at >= ?');
    params.push(toDbTime(from));
  }
  if (to) {
    where.push('published_at <= ?');
    params.push(toDbTime(to));
  }
  const [row] = await db.query(
    `SELECT COUNT(*) AS articles, MIN(published_at) AS data_start, MAX(published_at) AS data_end FROM articles WHERE ${where.join(' AND ')}`,
    params,
  );
  const [fetched] = await db.query('SELECT MAX(fetched_at) AS updated FROM articles');
  return {
    articlesInWindow: row.articles,
    dataStart: toIso(row.data_start),
    dataEnd: toIso(row.data_end),
    dataUpdatedAt: toIso(fetched?.updated),
  };
}

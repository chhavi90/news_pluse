import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { createApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { createDb } from '../src/db.js';
import { createJobManager } from '../src/services/jobs.js';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'newspulse-'));
const HOUR = 3600 * 1000;
const iso = (hoursAgo) => new Date(Date.now() - hoursAgo * HOUR).toISOString().replace(/\.\d{3}Z$/, 'Z');

let db, server, base, script;

/** A fake child process so the tests never need Python. */
function fakeSpawn() {
  return () => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => {};
    setImmediate(() => {
      child.emit('spawn');
      script(child);
    });
    return child;
  };
}

async function seed() {
  const art = `INSERT INTO articles (url_hash,title_hash,source,url,title,summary,content_status,published_at,fetched_at,cluster_id,story_id)
               VALUES (?,?,?,?,?,?,?,?,?,?,?)`;
  const rows = [
    ['h1', 't1', 'BBC News', 'https://a/1', 'Quake hits coast', 's', 'ok', iso(30), iso(1), 1, 1],
    ['h2', 't2', 'NPR', 'https://a/2', 'Tsunami warning after quake', 's', 'ok', iso(28), iso(1), 1, 1],
    ['h3', 't3', 'The Guardian', 'https://a/3', 'Rescue teams search rubble', 's', 'failed', iso(10), iso(1), 1, null],
    ['h4', 't4', 'BBC News', 'https://a/4', 'Rates held', 's', 'ok', iso(5), iso(1), 4, null],
    ['h5', 't5', 'NPR', 'https://a/5', 'Rates unchanged', 's', 'ok', iso(4), iso(1), 4, null],
    ['h6', 't6', 'NPR', 'https://a/6', 'Local bakery wins award', 's', 'ok', iso(3), iso(1), 6, null],
  ];
  for (const r of rows) await db.run(art, r);
  const cl = `INSERT INTO clusters (id,label,keywords,representative_title,method,updated_at) VALUES (?,?,?,?,?,?)`;
  await db.run(cl, [1, 'Earthquake · Tsunami', '["earthquake","tsunami"]', 'Quake hits coast', 'tfidf', iso(0)]);
  await db.run(cl, [4, 'Rates · Bank', '["rates","bank"]', 'Rates held', 'tfidf', iso(0)]);
  await db.run(cl, [6, 'Bakery', '["bakery"]', 'Local bakery wins award', 'tfidf', iso(0)]);
}

const get = async (p) => {
  const res = await fetch(base + p);
  return { status: res.status, body: await res.json() };
};

before(async () => {
  const config = loadConfig({
    NODE_ENV: 'test',
    SQLITE_PATH: path.join(tmp, 'api.db'),
    INGEST_COOLDOWN_SECONDS: '0',
    INGEST_RATE_PER_MINUTE: '1000',
    CORS_ORIGINS: 'http://localhost:3000,https://*.vercel.app',
  });
  db = await createDb(config);
  await seed();
  const jobs = createJobManager({ config, db, spawnFn: fakeSpawn(), logger: { error() {} } });
  await jobs.init();
  server = createApp({ config, db, jobs }).listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server.close();
  await db.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('health & meta', () => {
  it('GET /health', async () => {
    const { status, body } = await get('/health');
    assert.equal(status, 200);
    assert.equal(body.status, 'ok');
  });
  it('unknown route -> 404 JSON', async () => {
    const { status, body } = await get('/nope');
    assert.equal(status, 404);
    assert.equal(body.error.code, 'not_found');
  });
  it('CORS allows configured origins incl. wildcard, rejects others', async () => {
    const ok = await fetch(`${base}/health`, { headers: { Origin: 'https://my-app-git-main.vercel.app' } });
    assert.equal(ok.headers.get('access-control-allow-origin'), 'https://my-app-git-main.vercel.app');
    const bad = await fetch(`${base}/health`, { headers: { Origin: 'https://evil.example' } });
    assert.equal(bad.headers.get('access-control-allow-origin'), null);
  });
});

describe('GET /clusters', () => {
  it('lists clusters with label, article count and time range', async () => {
    const { status, body } = await get('/clusters');
    assert.equal(status, 200);
    assert.equal(body.total, 3);
    const quake = body.clusters.find((c) => c.id === 1);
    assert.equal(quake.label, 'Earthquake · Tsunami');
    assert.equal(quake.articleCount, 3);
    assert.equal(quake.sourceCount, 3);
    assert.ok(new Date(quake.timeRange.start) < new Date(quake.timeRange.end));
  });
  it('minArticles hides singletons', async () => {
    const { body } = await get('/clusters?minArticles=2');
    assert.deepEqual(body.clusters.map((c) => c.id).sort(), [1, 4]);
  });
  it('source filter recomputes counts', async () => {
    const { body } = await get('/clusters?sources=NPR');
    const byId = Object.fromEntries(body.clusters.map((c) => [c.id, c]));
    assert.equal(byId[1].articleCount, 1);
    assert.equal(byId[4].articleCount, 1);
  });
  it('sort=size puts the biggest first; pagination works', async () => {
    const { body } = await get('/clusters?sort=size&limit=1');
    assert.equal(body.clusters.length, 1);
    assert.equal(body.clusters[0].id, 1);
    const page2 = await get('/clusters?sort=size&limit=1&offset=1');
    assert.equal(page2.body.clusters[0].id, 4);
  });
  for (const q of ['minArticles=abc', 'limit=0', 'limit=9999', 'sort=weird', 'from=yesterday-ish', 'offset=-1']) {
    it(`rejects invalid query ${q} with 400`, async () => {
      const { status, body } = await get(`/clusters?${q}`);
      assert.equal(status, 400);
      assert.equal(body.error.code, 'bad_request');
    });
  }
});

describe('GET /clusters/:id', () => {
  it('returns all articles sorted chronologically plus story info', async () => {
    const { status, body } = await get('/clusters/1');
    assert.equal(status, 200);
    assert.equal(body.articles.length, 3);
    const times = body.articles.map((a) => new Date(a.publishedAt).getTime());
    assert.deepEqual(times, [...times].sort((a, b) => a - b));
    assert.equal(body.articles[0].source, 'BBC News');
    assert.equal(body.stories.length, 1);
    assert.deepEqual(body.stories[0].sources, ['BBC News', 'NPR']);
    assert.equal(body.articles[0].storyId, 1);
    assert.equal(body.keywords[0], 'earthquake');
  });
  it('404 for a missing cluster, 400 for a malformed id', async () => {
    assert.equal((await get('/clusters/999')).status, 404);
    assert.equal((await get('/clusters/abc')).status, 400);
    assert.equal((await get('/clusters/0')).status, 400);
    assert.equal((await get('/clusters/1;DROP TABLE articles')).status, 400);
  });
  it('honours the source filter', async () => {
    const { body } = await get('/clusters/1?sources=NPR');
    assert.equal(body.articles.length, 1);
    assert.equal(body.sourceCount, 1);
  });
});

describe('GET /timeline', () => {
  it('returns interval-shaped clusters with intensity', async () => {
    const { status, body } = await get('/timeline?hours=48');
    assert.equal(status, 200);
    assert.equal(body.clusters.length, 2); // default minArticles=2
    const [first] = body.clusters;
    assert.ok(first.start && first.end && first.durationMinutes > 0);
    assert.equal(first.id, 1); // sorted by start
    assert.equal(first.intensity, 1);
    assert.equal(body.clusters[1].intensity, Number((2 / 3).toFixed(3)));
    assert.equal(body.meta.maxArticleCount, 3);
    assert.equal(body.meta.windowHours, 48);
    assert.ok(body.meta.dataUpdatedAt);
  });
  it('time window and source filters apply', async () => {
    const narrow = await get('/timeline?hours=6&minArticles=1');
    assert.deepEqual(narrow.body.clusters.map((c) => c.id).sort(), [4, 6]);
    const bbc = await get('/timeline?sources=BBC%20News&minArticles=1');
    assert.equal(bbc.body.clusters.length, 2);
    assert.ok(bbc.body.clusters.every((c) => c.sources.every((s) => s.name === 'BBC News')));
  });
  it('validates parameters', async () => {
    assert.equal((await get('/timeline?hours=0')).status, 400);
    assert.equal((await get('/timeline?hours=x')).status, 400);
    assert.equal((await get('/timeline?from=2030-01-01&to=2020-01-01')).status, 400);
  });
});

describe('GET /sources', () => {
  it('lists outlets with counts', async () => {
    const { body } = await get('/sources');
    const npr = body.sources.find((s) => s.name === 'NPR');
    assert.equal(npr.articleCount, 3);
  });
});

describe('ingest jobs', () => {
  const post = async () => {
    const res = await fetch(`${base}/ingest/trigger`, { method: 'POST' });
    return { status: res.status, body: await res.json() };
  };
  const waitFor = async (jobId, status) => {
    for (let i = 0; i < 50; i++) {
      const { body } = await get(`/ingest/status/${jobId}`);
      if (body.status === status) return body;
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error(`job never reached ${status}`);
  };

  it('trigger -> 202 with a job id, runs, reports stats', async () => {
    script = (child) => {
      child.stdout.emit('data', Buffer.from('STAGE:fetching feeds\nsome log line\n'));
      setTimeout(() => {
        child.stdout.emit('data', Buffer.from('RESULT_JSON:{"new_articles":7,"clusters":3}\n'));
        child.emit('close', 0, null);
      }, 50);
    };
    const { status, body } = await post();
    assert.equal(status, 202);
    assert.match(body.jobId, /^[0-9a-f-]{36}$/);
    const done = await waitFor(body.jobId, 'succeeded');
    assert.equal(done.stats.new_articles, 7);
    assert.ok(done.logTail.includes('some log line'));
    assert.ok(done.finishedAt);
  });

  it('a second trigger while running returns the same job', async () => {
    script = (child) => setTimeout(() => child.emit('close', 0, null), 150);
    const a = await post();
    const b = await post();
    assert.equal(b.body.jobId, a.body.jobId);
    assert.equal(b.body.alreadyRunning, true);
    await waitFor(a.body.jobId, 'succeeded');
  });

  it('a failing pipeline is reported as failed with the log tail', async () => {
    script = (child) => {
      child.stdout.emit('data', Buffer.from('boom: every feed failed\n'));
      child.emit('close', 1, null);
    };
    const { body } = await post();
    const failed = await waitFor(body.jobId, 'failed');
    assert.match(failed.error, /code 1/);
    assert.match(failed.error, /every feed failed/);
  });

  it('a missing Python binary is reported clearly', async () => {
    script = (child) => child.emit('error', new Error('spawn python ENOENT'));
    const { body } = await post();
    const failed = await waitFor(body.jobId, 'failed');
    assert.match(failed.error, /PYTHON_BIN/);
  });

  it('status endpoint validates and 404s', async () => {
    assert.equal((await get('/ingest/status/not-a-uuid')).status, 400);
    assert.equal((await get('/ingest/status/00000000-0000-4000-8000-000000000000')).status, 404);
  });

  it('invalid JSON body -> 400', async () => {
    const res = await fetch(`${base}/ingest/trigger`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{bad' });
    assert.equal(res.status, 400);
  });
});

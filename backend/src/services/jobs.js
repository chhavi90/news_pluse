import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import { HttpError } from '../lib/http.js';
import { toDbTime, toIso } from '../lib/time.js';

const MAX_LOG_LINES = 40;

function mapJob(row) {
  if (!row) return null;
  const safeJson = (s, fallback) => {
    try {
      return s ? JSON.parse(s) : fallback;
    } catch {
      return fallback;
    }
  };
  const started = row.started_at ? new Date(row.started_at) : null;
  const finished = row.finished_at ? new Date(row.finished_at) : null;
  return {
    jobId: row.id,
    status: row.status, // queued | running | succeeded | failed
    stage: row.stage,
    createdAt: toIso(row.created_at),
    startedAt: toIso(row.started_at),
    finishedAt: toIso(row.finished_at),
    durationSeconds: started && finished ? Math.round((finished - started) / 1000) : null,
    stats: safeJson(row.stats, null),
    error: row.error,
    logTail: safeJson(row.log_tail, []),
  };
}

/**
 * Runs the Python pipeline (`python -m scraper.run`) as a child process and records progress in the
 * `jobs` table so the frontend can poll it. Only one job runs at a time.
 */
export function createJobManager({ config, db, spawnFn = spawn, logger = console }) {
  let current = null; // { id, child, timer, done }
  let lastFinishedAt = 0;

  async function init() {
    // Jobs left "running" by a previous server process can never finish - close them out.
    await db.run(
      `UPDATE jobs SET status = 'failed', error = ?, finished_at = ? WHERE status IN ('queued', 'running')`,
      ['Server restarted before the job finished', toDbTime(new Date())],
    );
  }

  async function getJob(id) {
    const [row] = await db.query('SELECT * FROM jobs WHERE id = ?', [id]);
    return mapJob(row);
  }

  async function finish(job, { status, error = null, stats = null, ring }) {
    if (job.done) return;
    job.done = true;
    clearTimeout(job.timer);
    current = null;
    lastFinishedAt = Date.now();
    try {
      await db.run(
        `UPDATE jobs SET status = ?, error = ?, stats = ?, log_tail = ?, finished_at = ?, stage = ? WHERE id = ?`,
        [status, error, stats ? JSON.stringify(stats) : null, JSON.stringify(ring.slice(-20)), toDbTime(new Date()),
          status === 'succeeded' ? 'done' : null, job.id],
      );
    } catch (err) {
      logger.error('[jobs] could not persist job result:', err.message);
    }
  }

  function launch(job) {
    const ring = [];
    let stats = null;
    let lastStage = null;
    const push = (line) => {
      const text = line.trim();
      if (!text) return;
      if (text.startsWith('RESULT_JSON:')) {
        try {
          stats = JSON.parse(text.slice('RESULT_JSON:'.length));
        } catch {
          /* ignore malformed summary */
        }
        return;
      }
      if (text.startsWith('STAGE:')) {
        lastStage = text.slice('STAGE:'.length).trim();
        db.run('UPDATE jobs SET stage = ? WHERE id = ?', [lastStage, job.id]).catch(() => {});
        return;
      }
      ring.push(text.slice(0, 400));
      if (ring.length > MAX_LOG_LINES) ring.shift();
    };
    const lineReader = () => {
      let buf = '';
      return (chunk) => {
        buf += chunk.toString('utf8');
        const parts = buf.split(/\r?\n/);
        buf = parts.pop() ?? '';
        parts.forEach(push);
      };
    };

    let child;
    try {
      child = spawnFn(config.pythonBin, ['-m', 'scraper.run', '--json'], {
        cwd: config.scraperParentDir,
        env: { ...process.env, PYTHONUNBUFFERED: '1', PYTHONIOENCODING: 'utf-8' },
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
    } catch (err) {
      finish(job, { status: 'failed', error: `Could not start the Python pipeline: ${err.message}`, ring });
      return;
    }
    job.child = child;
    child.stdout?.on('data', lineReader());
    child.stderr?.on('data', lineReader());

    child.on('spawn', () => {
      db.run(`UPDATE jobs SET status = 'running', started_at = ? WHERE id = ?`, [toDbTime(new Date()), job.id]).catch(() => {});
    });
    child.on('error', (err) => {
      finish(job, {
        status: 'failed',
        error: `Could not start Python ("${config.pythonBin}"): ${err.message}. Set PYTHON_BIN in backend/.env.`,
        ring,
      });
    });
    child.on('close', (code, signal) => {
      if (code === 0) return finish(job, { status: 'succeeded', stats, ring });
      const tail = ring.slice(-4).join(' | ');
      return finish(job, { status: 'failed', error: `Pipeline exited with ${signal ?? `code ${code}`}. ${tail}`.trim(), ring });
    });
    job.timer = setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch {
        /* already gone */
      }
      finish(job, { status: 'failed', error: `Pipeline timed out after ${config.ingestTimeoutSeconds}s`, ring });
    }, config.ingestTimeoutSeconds * 1000);
    job.timer.unref?.();
  }

  /** Start a run - or hand back the one already in progress. */
  async function trigger() {
    if (current) return { job: await getJob(current.id), reused: true };

    const waitMs = config.ingestCooldownSeconds * 1000 - (Date.now() - lastFinishedAt);
    if (waitMs > 0) {
      const seconds = Math.ceil(waitMs / 1000);
      throw new HttpError(429, `Data was refreshed moments ago. Try again in ${seconds}s.`, 'cooldown', { retryAfterSeconds: seconds });
    }

    const id = crypto.randomUUID();
    await db.run(`INSERT INTO jobs (id, status, stage, created_at) VALUES (?, 'queued', 'queued', ?)`, [id, toDbTime(new Date())]);
    current = { id, child: null, timer: null, done: false };
    launch(current);
    return { job: await getJob(id), reused: false };
  }

  function shutdown() {
    if (current?.child) {
      try {
        current.child.kill('SIGTERM');
      } catch {
        /* ignore */
      }
    }
  }

  return { init, trigger, getJob, shutdown };
}

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const here = path.dirname(fileURLToPath(import.meta.url));

/** Repository root (backend/src -> backend -> repo). */
export const REPO_ROOT = path.resolve(here, '../..');

// Real environment variables always win over the .env file.
dotenv.config({ path: path.resolve(here, '../.env'), quiet: true });

function intVar(env, name, fallback, { min = -Infinity, max = Infinity } = {}) {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number.parseInt(raw, 10);
  if (Number.isNaN(value)) throw new Error(`Environment variable ${name} must be an integer (got "${raw}")`);
  return Math.min(max, Math.max(min, value));
}

function detectPython(env) {
  if (env.PYTHON_BIN) return env.PYTHON_BIN;
  const venv =
    process.platform === 'win32'
      ? path.join(REPO_ROOT, '.venv', 'Scripts', 'python.exe')
      : path.join(REPO_ROOT, '.venv', 'bin', 'python');
  if (fs.existsSync(venv)) return venv; // use the project virtualenv automatically
  return process.platform === 'win32' ? 'python' : 'python3';
}

function resolveSqlitePath(value) {
  if (!value) return path.join(REPO_ROOT, 'data', 'newspulse.db');
  return path.isAbsolute(value) ? value : path.resolve(REPO_ROOT, value);
}

/** Build the (validated) configuration object from environment variables. */
export function loadConfig(env = process.env) {
  const databaseUrl = (env.DATABASE_URL || '').trim();
  return Object.freeze({
    nodeEnv: env.NODE_ENV || 'development',
    port: intVar(env, 'PORT', 4000, { min: 1, max: 65535 }),
    databaseUrl,
    databaseSsl: (env.DATABASE_SSL || '').trim().toLowerCase(), // '', 'no-verify' or 'disable'
    sqlitePath: resolveSqlitePath((env.SQLITE_PATH || '').trim()),
    schemaDir: path.join(REPO_ROOT, 'db'),
    corsOrigins: (env.CORS_ORIGINS || 'http://localhost:3000,http://127.0.0.1:3000')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    trustProxy: intVar(env, 'TRUST_PROXY', env.NODE_ENV === 'production' ? 1 : 0, { min: 0, max: 5 }),
    pythonBin: detectPython(env),
    scraperParentDir: REPO_ROOT, // `python -m scraper.run` is executed from here
    ingestTimeoutSeconds: intVar(env, 'INGEST_TIMEOUT_SECONDS', 600, { min: 10 }),
    ingestCooldownSeconds: intVar(env, 'INGEST_COOLDOWN_SECONDS', 15, { min: 0 }),
    ingestRatePerMinute: intVar(env, 'INGEST_RATE_PER_MINUTE', 6, { min: 1 }),
    logRequests: env.NODE_ENV !== 'test',
  });
}

import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';

// node-postgres returns bigint (COUNT) and timestamptz as strings/Dates by default - make them
// behave the same as SQLite so route code does not care which database is in use.
pg.types.setTypeParser(20, (v) => Number.parseInt(v, 10)); // int8
pg.types.setTypeParser(1700, (v) => Number.parseFloat(v)); // numeric
pg.types.setTypeParser(1184, (v) => new Date(v).toISOString()); // timestamptz

const toPgSql = (sql) => {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
};

async function createPostgres(config) {
  let ssl;
  if (config.databaseSsl === 'no-verify') ssl = { rejectUnauthorized: false };
  else if (config.databaseSsl === 'disable') ssl = false;
  const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 5, idleTimeoutMillis: 30_000, ssl });
  pool.on('error', (err) => console.error('[db] idle client error:', err.message));
  return {
    dialect: 'postgres',
    async query(sql, params = []) {
      return (await pool.query(toPgSql(sql), params)).rows;
    },
    async run(sql, params = []) {
      const res = await pool.query(toPgSql(sql), params);
      return { changes: res.rowCount ?? 0 };
    },
    async exec(sql) {
      await pool.query(sql);
    },
    async close() {
      await pool.end();
    },
  };
}

async function createSqlite(config) {
  // Imported lazily so a Postgres-only deployment never needs the native module.
  const { default: Database } = await import('better-sqlite3');
  fs.mkdirSync(path.dirname(config.sqlitePath), { recursive: true });
  const db = new Database(config.sqlitePath);
  db.pragma('journal_mode = WAL'); // lets the API read while the Python pipeline writes
  db.pragma('busy_timeout = 30000');
  return {
    dialect: 'sqlite',
    async query(sql, params = []) {
      return db.prepare(sql).all(...params);
    },
    async run(sql, params = []) {
      return { changes: db.prepare(sql).run(...params).changes };
    },
    async exec(sql) {
      db.exec(sql);
    },
    async close() {
      db.close();
    },
  };
}

export async function createDb(config) {
  const db = config.databaseUrl ? await createPostgres(config) : await createSqlite(config);
  const schema = fs.readFileSync(path.join(config.schemaDir, `schema.${db.dialect}.sql`), 'utf8');
  await db.exec(schema); // idempotent (CREATE ... IF NOT EXISTS), shared with the Python pipeline
  return db;
}

import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { createDb } from './db.js';
import { createJobManager } from './services/jobs.js';

const config = loadConfig();
const db = await createDb(config);
const jobs = createJobManager({ config, db });
await jobs.init();

const app = createApp({ config, db, jobs });
const server = app.listen(config.port, () => {
  console.log(`News Pulse API listening on :${config.port}  (db: ${db.dialect}, python: ${config.pythonBin})`);
});

async function shutdown(signal) {
  console.log(`${signal} received - shutting down`);
  jobs.shutdown();
  server.close(async () => {
    await db.close().catch(() => {});
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 8000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

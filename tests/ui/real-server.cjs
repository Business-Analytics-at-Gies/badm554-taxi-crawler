// Runs the real server package (crew/server) on this package's site, for the integration test.
// SERVER_DIR: the server worktree (default ../badm554-taxi-crawler-server).
// DB_SITE: a site/ folder with game/db/ and vendor/ (default ../badm554-taxi-crawler-db/site).
// The server refuses symlinks out of its root, so the three parts are copied into one temp folder.
const { cpSync, mkdtempSync, existsSync } = require('node:fs');
const { join, resolve } = require('node:path');
const { tmpdir } = require('node:os');

const ROOT = resolve(__dirname, '../..');
const SERVER_DIR = resolve(process.env.SERVER_DIR || join(ROOT, '../badm554-taxi-crawler-server'));
const DB_SITE = resolve(process.env.DB_SITE || join(ROOT, '../badm554-taxi-crawler-db/site'));
const tmp = mkdtempSync(join(tmpdir(), 'taxi-ui-'));
const site = join(tmp, 'site');
cpSync(join(ROOT, 'site'), site, { recursive: true });
for (const part of ['game/db', 'vendor']) {
  if (!existsSync(join(DB_SITE, part))) throw new Error(`missing ${join(DB_SITE, part)}`);
  cpSync(join(DB_SITE, part), join(site, part), { recursive: true });
}
const { createApp } = require(join(SERVER_DIR, 'server/index.js'));
const app = createApp({
  siteRoot: site, dataRoot: join(ROOT, 'data'),
  env: { AUTH_MODE: 'dev', FAKE_MODEL: '1', RECEIPT_SECRET: 'ui-integration-test-only', DB_PATH: join(tmp, 'taxi.db'), PORT: process.env.PORT || '4177' },
});
app.server.listen(Number(process.env.PORT || 4177), '127.0.0.1', () => console.log(`real server on ${app.server.address().port}, site ${site}`));
for (const s of ['SIGTERM', 'SIGINT']) process.once(s, () => app.close().then(() => process.exit(0)));

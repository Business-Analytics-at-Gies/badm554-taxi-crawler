#!/usr/bin/env node
const { DatabaseSync } = require('node:sqlite');
const { resolve } = require('node:path');

function main(args, env) {
  if (!env.DB_PATH) throw new Error('Explicit DB_PATH is required');
  const path = resolve(env.DB_PATH);
  if (args.length === 1 && args[0] === 'aggregates') {
    const db = new DatabaseSync(path, { readOnly: true });
    try {
      const activities = db.prepare('SELECT activity id,SUM(amount)/1000000000.0 cost_usd FROM proxy_ledger GROUP BY activity ORDER BY activity').all();
      const students = db.prepare('SELECT owner,activity,SUM(amount)/1000000000.0 cost_usd FROM proxy_ledger GROUP BY owner,activity ORDER BY activity,owner').all();
      process.stdout.write(`${JSON.stringify({ activities, students })}\n`);
    } finally { db.close(); }
  } else if (args.length === 3 && args[0] === 'revoke' && args[1] === '--token-id' && /^[a-f0-9-]{36}$/.test(args[2])) {
    const db = new DatabaseSync(`${path}.identity.sqlite`);
    try {
      db.exec('PRAGMA busy_timeout=5000; PRAGMA synchronous=FULL; PRAGMA secure_delete=ON;');
      const result = db.prepare('UPDATE proxy_tokens SET revoked_at=COALESCE(revoked_at,?) WHERE id=?').run(new Date().toISOString(), args[2]);
      if (!result.changes) throw new Error('Token not found');
      process.stdout.write('{"ok":true}\n');
    } finally { db.close(); }
  } else throw new Error('Usage: proxy-admin.js aggregates | revoke --token-id <id>');
}
if (require.main === module) {
  try { main(process.argv.slice(2), process.env); }
  catch { process.stderr.write('Proxy administration failed. Check the command and database path.\n'); process.exitCode = 2; }
}
module.exports = { main };

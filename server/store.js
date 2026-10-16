const { DatabaseSync } = require('node:sqlite');
const { mkdirSync } = require('node:fs');
const { dirname } = require('node:path');
const { randomBytes, createHmac } = require('node:crypto');

class Store {
  constructor(config, now) {
    this.config = config;
    this.now = now;
    mkdirSync(dirname(config.dbPath), { recursive: true, mode: 0o700 });
    this.chat = new DatabaseSync(config.dbPath);
    this.identity = new DatabaseSync(`${config.dbPath}.identity.sqlite`);
    for (const db of [this.chat, this.identity]) db.exec('PRAGMA journal_mode=DELETE; PRAGMA busy_timeout=5000; PRAGMA synchronous=FULL;');
    this.chat.exec(`
      CREATE TABLE IF NOT EXISTS history (session TEXT, role TEXT, text TEXT, at TEXT);
      CREATE TABLE IF NOT EXISTS turns (session TEXT PRIMARY KEY, state TEXT NOT NULL);
    `);
    this.identity.exec(`CREATE TABLE IF NOT EXISTS receipts (
      pilot TEXT, dataset TEXT, session TEXT, floor INTEGER, at TEXT, code TEXT UNIQUE,
      PRIMARY KEY (pilot, dataset, session, floor)
    );`);
  }
  history(session) {
    return this.chat.prepare('SELECT role,text,at FROM history WHERE session=? ORDER BY rowid').all(session);
  }
  addHistory(session, role, text) {
    if (text) this.chat.prepare('INSERT INTO history VALUES (?,?,?,?)').run(session, role, text, new Date(this.now()).toISOString());
  }
  turn(session) {
    const row = this.chat.prepare('SELECT state FROM turns WHERE session=?').get(session);
    return row ? JSON.parse(row.state) : null;
  }
  saveTurn(session, state) {
    this.chat.prepare('INSERT INTO turns VALUES (?,?) ON CONFLICT(session) DO UPDATE SET state=excluded.state').run(session, JSON.stringify(state));
  }
  receipt(session, floor) {
    const { pilot, dataset, receiptSecret } = this.config;
    const old = this.identity.prepare('SELECT floor,code FROM receipts WHERE pilot=? AND dataset=? AND session=? AND floor=?').get(pilot, dataset, session, floor);
    if (old) return { ...old };
    let code;
    do {
      const entropy = randomBytes(32);
      const bytes = receiptSecret ? createHmac('sha256', receiptSecret).update(`${pilot}:${dataset}:${session}:${floor}:`).update(entropy).digest() : entropy;
      // Rejection sampling gives each of the 26 letters equal probability.
      const letters = [...bytes].filter(n => n < 234).map(n => String.fromCharCode(65 + n % 26)).join('').slice(0, 8);
      if (letters.length !== 8) continue;
      code = `TAXI-${floor}-${letters}`;
    } while (!code || this.identity.prepare('SELECT 1 FROM receipts WHERE code=?').get(code));
    this.identity.prepare('INSERT OR IGNORE INTO receipts VALUES (?,?,?,?,?,?)').run(pilot, dataset, session, floor, new Date(this.now()).toISOString(), code);
    return { ...this.identity.prepare('SELECT floor,code FROM receipts WHERE pilot=? AND dataset=? AND session=? AND floor=?').get(pilot, dataset, session, floor) };
  }
  close() { this.chat.close(); this.identity.close(); }
}
module.exports = { Store };

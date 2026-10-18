const { DatabaseSync } = require('node:sqlite');
const { mkdirSync, chmodSync } = require('node:fs');
const { dirname } = require('node:path');
const { randomBytes, createHmac, randomUUID } = require('node:crypto');
const { refuse } = require('./errors');

const nanos = usd => {
  const value = Math.ceil(usd * 1e9 - 1e-7);
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('Invalid money amount');
  return value;
};
const day = time => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(time);

class Store {
  constructor(config, now) {
    this.config = config;
    this.now = now;
    mkdirSync(dirname(config.dbPath), { recursive: true, mode: 0o700 });
    this.chat = new DatabaseSync(config.dbPath);
    this.identity = new DatabaseSync((config.identityPath || `${config.dbPath}.identity.sqlite`));
    chmodSync(config.dbPath, 0o600);
    chmodSync((config.identityPath || `${config.dbPath}.identity.sqlite`), 0o600);
    for (const db of [this.chat, this.identity]) db.exec('PRAGMA busy_timeout=5000; PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA secure_delete=ON;');
    this.chat.exec(`
      CREATE TABLE IF NOT EXISTS history (session TEXT, role TEXT, text TEXT, at TEXT);
      CREATE TABLE IF NOT EXISTS turns (session TEXT PRIMARY KEY, state TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS questions (quota TEXT, day TEXT, at INTEGER);
      CREATE INDEX IF NOT EXISTS questions_quota ON questions(quota,day,at);
      CREATE TABLE IF NOT EXISTS ledger (
        id TEXT PRIMARY KEY, session TEXT, quota TEXT, day TEXT, amount INTEGER NOT NULL,
        reserved INTEGER NOT NULL, status TEXT NOT NULL, at INTEGER
      );
      CREATE INDEX IF NOT EXISTS ledger_quota ON ledger(quota,day);
      CREATE TABLE IF NOT EXISTS request_log (
        id TEXT PRIMARY KEY, session TEXT, at TEXT, status TEXT,
        input_tokens INTEGER, output_tokens INTEGER, cache_creation_input_tokens INTEGER,
        cache_read_input_tokens INTEGER, cost_usd REAL
      );
      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY,value TEXT);
    `);
    this.identity.exec(`
      CREATE TABLE IF NOT EXISTS principals (subject TEXT PRIMARY KEY, quota TEXT UNIQUE NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY, mode TEXT NOT NULL, subject TEXT, quota TEXT NOT NULL,
        cookie_hash TEXT UNIQUE, created INTEGER NOT NULL, revoked INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS sessions_subject ON sessions(subject,revoked);
      CREATE TABLE IF NOT EXISTS receipts (
      pilot TEXT, dataset TEXT, session TEXT, floor INTEGER, at TEXT, code TEXT UNIQUE,
      PRIMARY KEY (pilot, dataset, session, floor)
    );`);
  }
  identityTransaction(fn) {
    this.identity.exec('BEGIN IMMEDIATE');
    try { const result = fn(); this.identity.exec('COMMIT'); return result; }
    catch (error) { this.identity.exec('ROLLBACK'); throw error; }
  }
  entraSession(subject) {
    return this.identityTransaction(() => {
      const current = this.identity.prepare("SELECT id,quota FROM sessions WHERE mode='entra' AND subject=? AND revoked=0").get(subject);
      if (current) return current;
      this.identity.prepare('INSERT OR IGNORE INTO principals VALUES (?,?)').run(subject, randomUUID());
      const { quota } = this.identity.prepare('SELECT quota FROM principals WHERE subject=?').get(subject);
      const id = randomUUID();
      this.identity.prepare('INSERT INTO sessions VALUES (?,?,?,?,?,?,0)').run(id, 'entra', subject, quota, null, this.now());
      return { id, quota };
    });
  }
  joinSession(cookieHash) {
    return this.identityTransaction(() => {
      if (this.identity.prepare("SELECT COUNT(*) AS n FROM sessions WHERE mode='join'").get().n >= 120) refuse(429, 'cap_questions', 'The class session limit has been reached. Please contact the instructor.');
      if (this.identity.prepare("SELECT COUNT(*) AS n FROM sessions WHERE mode='join' AND created>?").get(this.now() - 60000).n >= 10) refuse(429, 'cap_rate', 'Please wait a minute before joining.');
      const id = randomUUID(), quota = randomUUID();
      this.identity.prepare('INSERT INTO sessions VALUES (?,?,?,?,?,?,0)').run(id, 'join', null, quota, cookieHash, this.now());
      return { id, quota };
    });
  }
  cookieSession(hash) {
    return this.identity.prepare("SELECT id,quota FROM sessions WHERE mode='join' AND cookie_hash=? AND revoked=0").get(hash);
  }
  devSession() {
    this.identity.prepare("INSERT OR IGNORE INTO sessions VALUES ('dev','dev',NULL,'dev',NULL,?,0)").run(this.now());
    return { id: 'dev', quota: 'dev' };
  }
  forget(session) {
    this.transaction(() => {
      this.chat.prepare('DELETE FROM history WHERE session=?').run(session);
      this.chat.prepare('DELETE FROM turns WHERE session=?').run(session);
    });
    this.identity.prepare('UPDATE sessions SET revoked=1 WHERE id=?').run(session);
  }
  transaction(fn) {
    this.chat.exec('BEGIN IMMEDIATE');
    try { const result = fn(); this.chat.exec('COMMIT'); return result; }
    catch (error) { this.chat.exec('ROLLBACK'); throw error; }
  }
  total() { return this.chat.prepare('SELECT COALESCE(SUM(amount),0) AS n FROM ledger').get().n / 1e9; }
  usage(quota) {
    const today = day(this.now());
    return {
      spent: this.chat.prepare('SELECT COALESCE(SUM(amount),0) AS n FROM ledger WHERE quota=? AND day=?').get(quota, today).n / 1e9,
      questions: this.chat.prepare('SELECT COUNT(*) AS n FROM questions WHERE quota=? AND day=?').get(quota, today).n,
    };
  }
  reserve(session, quota, usd, first) {
    const amount = nanos(usd), today = day(this.now());
    return this.transaction(() => {
      const usage = this.usage(quota);
      if (this.chat.prepare("SELECT 1 FROM settings WHERE key='budget_hold'").get()) refuse(503, 'budget_exhausted', 'The tutor budget needs to be checked. The game is still available.');
      if (first && usage.questions >= this.config.questions) refuse(429, 'cap_questions', 'You have used today’s tutor questions. The game is still available.');
      if (first && this.chat.prepare('SELECT COUNT(*) AS n FROM questions WHERE quota=? AND at>?').get(quota, this.now() - 60000).n >= 4) refuse(429, 'cap_rate', 'Please wait a minute before asking another question.');
      if (nanos(usage.spent) + amount > nanos(this.config.daily)) refuse(429, 'cap_daily_usd', 'You have reached today’s tutor spending limit. The game is still available.');
      if (nanos(this.total()) + amount > nanos(this.config.budget)) refuse(503, 'budget_exhausted', 'The tutor budget is used up. The game is still available.');
      const id = randomUUID();
      this.chat.prepare('INSERT INTO ledger VALUES (?,?,?,?,?,?,?,?)').run(id, session, quota, today, amount, amount, 'reserved', this.now());
      this.chat.prepare('INSERT INTO request_log VALUES (?,?,?,?,?,?,?,?,?)').run(id, session, new Date(this.now()).toISOString(), 'reserved', null, null, null, null, amount / 1e9);
      if (first) this.chat.prepare('INSERT INTO questions VALUES (?,?,?)').run(quota, today, this.now());
      return id;
    });
  }
  settle(id, usd, usage) {
    const amount = nanos(usd);
    this.transaction(() => {
      const row = this.chat.prepare('SELECT * FROM ledger WHERE id=?').get(id);
      if (!row || row.status !== 'reserved') throw new Error('Reservation is not active');
      if (amount > row.reserved) this.chat.prepare("INSERT OR REPLACE INTO settings VALUES ('budget_hold','1')").run();
      this.chat.prepare("UPDATE ledger SET amount=?,status='settled' WHERE id=?").run(amount, id);
      this.chat.prepare("UPDATE request_log SET status='settled',input_tokens=?,output_tokens=?,cache_creation_input_tokens=?,cache_read_input_tokens=?,cost_usd=? WHERE id=?").run(
        usage.input_tokens, usage.output_tokens, usage.cache_creation_input_tokens || 0, usage.cache_read_input_tokens || 0, amount / 1e9, id,
      );
    });
  }
  unknown(id) {
    this.transaction(() => {
      this.chat.prepare("UPDATE ledger SET status='unknown' WHERE id=? AND status='reserved'").run(id);
      this.chat.prepare("UPDATE request_log SET status='unknown' WHERE id=? AND status='reserved'").run(id);
    });
  }
  recover() {
    this.transaction(() => {
      this.chat.prepare("UPDATE ledger SET status='unknown' WHERE status='reserved'").run();
      this.chat.prepare("UPDATE request_log SET status='unknown' WHERE status='reserved'").run();
      for (const row of this.chat.prepare('SELECT * FROM turns').all()) {
        const state = JSON.parse(row.state);
        if (state.inflight || (!state.done && !state.pending.length)) {
          this.saveTurn(row.session, { ...state, inflight: false, done: true, pending: [], internalResults: [], messages: [] });
        }
      }
    });
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
    const publicFloor = floor;
    floor = this.config.receiptFloors?.[floor] ?? floor;
    const old = this.identity.prepare('SELECT floor,code FROM receipts WHERE pilot=? AND dataset=? AND session=? AND floor=?').get(pilot, dataset, session, floor);
    if (old) return { ...old, floor: publicFloor };
    let code;
    do {
      const entropy = randomBytes(32);
      const bytes = receiptSecret ? createHmac('sha256', receiptSecret).update(`${pilot}:${dataset}:${session}:${floor}:`).update(entropy).digest() : entropy;
      // Rejection sampling gives each of the 26 letters equal probability.
      const letters = [...bytes].filter(n => n < 234).map(n => String.fromCharCode(65 + n % 26)).join('').slice(0, 8);
      if (letters.length !== 8) continue;
      code = `${this.config.receiptPrefix || 'TAXI'}-${publicFloor}-${letters}`;
    } while (!code || this.identity.prepare('SELECT 1 FROM receipts WHERE code=?').get(code));
    this.identity.prepare('INSERT OR IGNORE INTO receipts VALUES (?,?,?,?,?,?)').run(pilot, dataset, session, floor, new Date(this.now()).toISOString(), code);
    return { ...this.identity.prepare('SELECT floor,code FROM receipts WHERE pilot=? AND dataset=? AND session=? AND floor=?').get(pilot, dataset, session, floor), floor: publicFloor };
  }
  close() { this.chat.close(); this.identity.close(); }
}
module.exports = { Store };

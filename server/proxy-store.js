const { randomBytes, randomUUID, createHash } = require('node:crypto');
const { refuse } = require('./errors');
const { fields, bill, progress } = require('./proxy-usage');
const { PRICES } = require('./model');
const nano = n => {
  const result = Math.ceil(n * 1e9 - 1e-7);
  if (!Number.isSafeInteger(result) || result < 0) throw new Error('Invalid proxy amount');
  return result;
};
const day = t => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(t);
const metadata = row => row ? { id: row.id, created_at: row.created_at, expires_at: row.expires_at, revoked_at: row.revoked_at } : null;
class ProxyStore {
  constructor(store, cfg, now) {
    this.store = store; this.cfg = cfg; this.now = now;
    this.db = store.chat; this.identity = store.identity;
    this.identity.exec(`CREATE TABLE IF NOT EXISTS proxy_tokens (
      id TEXT PRIMARY KEY, token_hash TEXT UNIQUE NOT NULL, owner TEXT NOT NULL, activity TEXT NOT NULL,
      created_at TEXT NOT NULL, expires_at TEXT NOT NULL, revoked_at TEXT);
      CREATE INDEX IF NOT EXISTS proxy_token_owner ON proxy_tokens(owner,activity);`);
    this.db.exec(`CREATE TABLE IF NOT EXISTS proxy_ledger (
      id TEXT PRIMARY KEY, token_id TEXT, owner TEXT, activity TEXT, day TEXT, model TEXT,
      amount INTEGER NOT NULL, reserved INTEGER NOT NULL, status TEXT NOT NULL, at INTEGER);
      CREATE INDEX IF NOT EXISTS proxy_ledger_owner ON proxy_ledger(activity,owner,day);
      CREATE TABLE IF NOT EXISTS proxy_request_log (
      id TEXT PRIMARY KEY, token_id TEXT, activity TEXT, model TEXT, at INTEGER, status TEXT,
      input_tokens INTEGER, output_tokens INTEGER, cache_creation_input_tokens INTEGER,
      cache_read_input_tokens INTEGER, cache_write_hour_tokens INTEGER, cost_usd REAL);
      CREATE TABLE IF NOT EXISTS proxy_settings (key TEXT PRIMARY KEY,value TEXT);
      CREATE TABLE IF NOT EXISTS proxy_rate (token_id TEXT, at INTEGER);
      CREATE INDEX IF NOT EXISTS proxy_rate_token ON proxy_rate(token_id,at);`);
    if (!PRICES[cfg.model]?.confirmed) throw new Error('Proxy pricing unavailable');
  }
  open() {
    if (!this.cfg.enabled || this.now() >= Date.parse(this.cfg.closesAt)) refuse(403, 'proxy_closed', 'Course API credit is closed.');
  }
  list(owner) {
    return metadata(this.identity.prepare('SELECT * FROM proxy_tokens WHERE owner=? AND activity=? ORDER BY rowid DESC LIMIT 1').get(owner, this.cfg.activity));
  }
  create(owner) {
    this.open();
    return this.store.identityTransaction(() => {
      this.revoke(owner);
      const token = `b554_${randomBytes(32).toString('base64url')}`;
      const key = { id: randomUUID(), created_at: new Date(this.now()).toISOString(), expires_at: this.cfg.closesAt, revoked_at: null };
      this.identity.prepare('INSERT INTO proxy_tokens VALUES (?,?,?,?,?,?,?)').run(key.id,
        createHash('sha256').update(token).digest('hex'), owner, this.cfg.activity, key.created_at, key.expires_at, null);
      return { token, key };
    });
  }
  revoke(owner) {
    this.identity.prepare('UPDATE proxy_tokens SET revoked_at=? WHERE owner=? AND activity=? AND revoked_at IS NULL')
      .run(new Date(this.now()).toISOString(), owner, this.cfg.activity);
  }
  identify(value) {
    if (typeof value !== 'string' || !/^b554_[A-Za-z0-9_-]{43}$/.test(value)) this.invalid();
    const row = this.identity.prepare('SELECT * FROM proxy_tokens WHERE token_hash=?').get(createHash('sha256').update(value).digest('hex'));
    if (!row || row.revoked_at || row.activity !== this.cfg.activity || this.now() >= Date.parse(row.expires_at)) this.invalid();
    return row;
  }
  invalid() { refuse(401, 'invalid_token', 'The course token is not valid. Create a new token on the course setup page.'); }
  sums(owner) {
    const rows = this.db.prepare(`SELECT owner,activity,day,status,amount FROM proxy_ledger`).all();
    const sum = selected => selected.reduce((n, r) => n + r.amount, 0);
    const personal = rows.filter(r => r.owner === owner && r.activity === this.cfg.activity), today = personal.filter(r => r.day === day(this.now()));
    return { personal: sum(personal), daily: sum(today), total: sum(rows),
      pendingPersonal: sum(personal.filter(r => r.status === 'reserved')),
      pendingDaily: sum(today.filter(r => r.status === 'reserved')),
      pendingTotal: sum(rows.filter(r => r.status === 'reserved')) };
  }
  usage(owner) {
    const n = this.sums(owner);
    return { activity_usd: n.personal / 1e9, today_usd: n.daily / 1e9, total_usd: n.total / 1e9 };
  }
  check(owner, amount, preflight = false) {
    if (this.db.prepare("SELECT 1 FROM proxy_settings WHERE key='budget_hold'").get()) refuse(503, 'budget_exhausted', 'The course API budget needs instructor review.');
    const n = this.sums(owner);
    for (const [value, pending, limit, status, code, message] of [
      [n.personal, n.pendingPersonal, this.cfg.student, 429, 'cap_student_usd', 'This request would exceed your activity budget.'],
      [n.daily, n.pendingDaily, this.cfg.daily, 429, 'cap_daily_usd', 'This request would exceed your daily budget.'],
      [n.total, n.pendingTotal, this.cfg.total, 503, 'budget_exhausted', 'The course API budget has no room for this request.'],
    ]) {
      if (value + amount > nano(limit) || (preflight && value >= nano(limit))) {
        const waiting = pending > 0 && value - pending + amount <= nano(limit);
        refuse(status, code, waiting ? "This request needs more budget than is free while another request finishes. Try again shortly." : message);
      }
    }
  }
  preflight(owner, generating) {
    this.store.transaction(() => {
      // This intentional no-op also checks writability when no setting rows exist.
      this.db.prepare('UPDATE proxy_settings SET value=value').run();
      this.check(owner, 0, generating);
    });
  }
  rate(token) {
    this.store.transaction(() => {
      const since = this.now() - 60000;
      const { n } = this.db.prepare('SELECT COUNT(*) n FROM proxy_rate WHERE token_id=? AND at>?').get(token.id, since);
      if (n >= this.cfg.rpm) refuse(429, 'cap_rate', 'Please wait a minute before another course API request.');
      this.db.prepare('DELETE FROM proxy_rate WHERE at<=?').run(since);
      this.db.prepare('INSERT INTO proxy_rate VALUES (?,?)').run(token.id, this.now());
    });
  }
  reserve(token, amount) {
    if (!Number.isSafeInteger(amount) || amount < 0) throw new Error('Invalid proxy reservation');
    return this.store.transaction(() => {
      this.check(token.owner, amount);
      const id = randomUUID();
      this.db.prepare('INSERT INTO proxy_ledger VALUES (?,?,?,?,?,?,?,?,?,?)').run(id, token.id, token.owner,
        token.activity, day(this.now()), this.cfg.model, amount, amount, 'reserved', this.now());
      this.db.prepare('INSERT INTO proxy_request_log (id,token_id,activity,model,at,status,cost_usd) VALUES (?,?,?,?,?,?,?)')
        .run(id, token.id, token.activity, this.cfg.model, this.now(), 'reserved', amount / 1e9);
      return id;
    });
  }
  authorizedDispatch(value, amount, start) {
    // Revoke/rotation writers share this identity lock. Admission stays serialized until
    // the already-durable chat reservation has been rechecked and transport is invoked.
    return this.store.identityTransaction(() => {
      const token = this.identify(value); this.open();
      const id = this.reserve(token, amount);
      try {
        this.identify(value); this.open();
        return { id, response: start() };
      } catch (error) {
        // No transport invocation occurred: this is a refusal, not an uncertain call.
        this.store.transaction(() => {
          this.db.prepare("DELETE FROM proxy_request_log WHERE id=? AND status='reserved'").run(id);
          this.db.prepare("DELETE FROM proxy_ledger WHERE id=? AND status='reserved'").run(id);
        });
        throw error;
      }
    });
  }
  hold(id) {
    this.store.transaction(() => {
      this.db.prepare("INSERT OR REPLACE INTO proxy_settings VALUES ('budget_hold','1')").run();
      if (id) {
        // Late malformed accounting must undo even a settlement at message_stop.
        this.db.prepare("UPDATE proxy_ledger SET amount=reserved,status='unknown' WHERE id=?").run(id);
        this.db.prepare(`UPDATE proxy_request_log SET status='unknown',input_tokens=NULL,output_tokens=NULL,
          cache_creation_input_tokens=NULL,cache_read_input_tokens=NULL,cache_write_hour_tokens=NULL,
          cost_usd=(SELECT reserved/1000000000.0 FROM proxy_ledger WHERE id=?) WHERE id=?`).run(id, id);
      }
    });
  }
  inspectUsage(usage, id, partial = false, previous) {
    try { fields(usage, this.cfg.model, false, partial); if (previous) progress(previous, usage); }
    catch (error) { this.hold(id); throw error; }
  }
  settle(id, usage, countOnly = false) {
    let amount = 0;
    if (!countOnly) {
      try { const result = bill(usage, PRICES[this.cfg.model], this.cfg.model); amount = nano(result.usd); usage = result.usage; }
      catch (error) { this.hold(id); throw error; }
    }
    this.store.transaction(() => {
      const row = this.db.prepare('SELECT * FROM proxy_ledger WHERE id=?').get(id);
      if (!row || row.status !== 'reserved') throw new Error('Inactive proxy reservation');
      if (amount > row.reserved) this.db.prepare("INSERT OR REPLACE INTO proxy_settings VALUES ('budget_hold','1')").run();
      this.db.prepare("UPDATE proxy_ledger SET amount=?,status='settled' WHERE id=?").run(amount, id);
      this.db.prepare(`UPDATE proxy_request_log SET status='settled',input_tokens=?,output_tokens=?,cache_creation_input_tokens=?,
        cache_read_input_tokens=?,cache_write_hour_tokens=?,cost_usd=? WHERE id=?`).run(usage.input_tokens, usage.output_tokens,
        usage.cache_creation_input_tokens || 0, usage.cache_read_input_tokens || 0, usage.cache_creation?.ephemeral_1h_input_tokens || 0, amount / 1e9, id);
    });
  }
  unknown(id) {
    this.store.transaction(() => {
      this.db.prepare("UPDATE proxy_ledger SET status='unknown' WHERE id=? AND status='reserved'").run(id);
      this.db.prepare("UPDATE proxy_request_log SET status='unknown' WHERE id=? AND status='reserved'").run(id);
    });
  }
  recover() {
    this.store.transaction(() => {
      this.db.prepare("UPDATE proxy_ledger SET status='unknown' WHERE status='reserved'").run();
      this.db.prepare("UPDATE proxy_request_log SET status='unknown' WHERE status='reserved'").run();
    });
  }
}
module.exports = { ProxyStore, nano };

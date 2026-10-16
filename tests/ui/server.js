// Test server for the UI package: serves site/ and data/ like the real server, and a mock /api
// that follows docs/interfaces.md part 1 with FAKE_MODEL semantics. Not shipped.
//
// Extra fake-model forms (mock only, for tests):
//   "tool:<name>"            one call of <name> with the same sample input as server/model.js
//   "tool:<name> {json}"     one call of <name> with that input
//   "say:<text>"             a text reply with exactly <text> (for markdown-safety tests)
// Introspection: GET /__mock/log, POST /__mock/reset, POST /__mock/config { open, signedIn }.
//
// DB_SITE=<path to a site/ folder> serves /game/db/* and /vendor/* from there (the real db
// package); without it, /game/db/db.js is the stub in tests/ui/stub/db.js.
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, resolve, extname, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');
const SITE = join(ROOT, 'site');
const DATA = join(ROOT, 'data');
const DB_SITE = process.env.DB_SITE ? resolve(process.env.DB_SITE) : null;
const PORT = Number(process.env.PORT || 4183);

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.csv': 'text/csv; charset=utf-8',
  '.sql': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml', '.wasm': 'application/wasm', '.parquet': 'application/octet-stream',
};

const SAMPLES = {
  run_sql: { sql: 'SELECT COUNT(*) AS rows FROM trips_raw' },
  lens: { sql: 'SELECT row_id, pu_location_id, do_location_id FROM trips_raw LIMIT 5', label: 'Look at these trips' },
  plant: { kind: 'duplicate', count: 1 }, unplant: { row_ids: [] }, undo_experiments: {},
  navigate: { room: 'floor1' }, highlight: { target: 'console', note: 'Try a row count here.' },
  game: { action: 'open', floor: 1 }, show_code: { file: 'floor1-reference' }, look: {},
};

let state;
function reset() {
  state = { open: true, signedIn: true, history: [], turn: null, receipts: {}, asks: [], continues: [], questions: 0 };
}
reset();

const send = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
};
const refuse = (res, status, error, message) => send(res, status, { error, message });
const exact = (body, keys) => body && typeof body === 'object' && !Array.isArray(body) &&
  Object.keys(body).length === keys.length && keys.every(k => Object.hasOwn(body, k));

function fake(question) {
  const say = question.match(/say:([\s\S]*)$/);
  if (say) return { text: say[1], calls: [] };
  const calls = [];
  for (const m of question.matchAll(/tool:([a-z_]+)(?:\s+(\{[^\n]*\}))?/g)) {
    if (!Object.hasOwn(SAMPLES, m[1])) continue;
    let input = SAMPLES[m[1]];
    if (m[2]) { try { input = JSON.parse(m[2]); } catch { /* keep the sample */ } }
    calls.push({ id: `tool_${randomUUID()}`, name: m[1], input });
  }
  return calls.length ? { text: '', calls } : { text: 'Start with the row count. What do you expect it to show?', calls: [] };
}

async function api(req, res, body) {
  const url = req.url.split('?')[0];
  if (req.method === 'POST' && !/^application\/json/.test(req.headers['content-type'] || '')) return refuse(res, 415, 'bad_request', 'Please send this request as JSON.');
  if (url === '/api/join' && req.method === 'POST') {
    if (!exact(body, ['code']) || body.code !== 'class') return refuse(res, 401, 'not_signed_in', 'That class code was not accepted.');
    state.signedIn = true;
  } else if (!state.signedIn) return refuse(res, 401, 'not_signed_in', 'Please sign in to continue.');

  if ((url === '/api/me' && req.method === 'GET') || url === '/api/join') {
    return send(res, 200, { session: 'dev', mode: 'dev', tutor: { open: state.open, closes_at: '2026-10-17T23:30:00.000Z', spent_today_usd: 0, cap_usd: 1.5, questions_left: Math.max(0, 40 - state.questions) } });
  }
  if (url === '/api/tutor/history' && req.method === 'GET') return send(res, 200, { messages: state.history });
  if (url === '/api/tutor/ask' && req.method === 'POST') {
    if (!exact(body, ['question', 'page']) || typeof body.question !== 'string' || typeof body.page !== 'string' || !body.question.trim()) return refuse(res, 400, 'bad_request', 'That request has unexpected or missing fields.');
    if (body.question.length > 1500 || body.page.length > 8000) return refuse(res, 400, 'too_long', 'That text is too long. Please shorten it.');
    if (!state.open) return refuse(res, 403, 'tutor_closed', 'The tutor has closed. You can still play the game.');
    if (state.turn && !state.turn.done) return refuse(res, 409, 'busy', 'Please finish the current tutor turn first.');
    state.asks.push(body); state.questions++;
    state.history.push({ role: 'learner', text: body.question, at: new Date().toISOString() });
    const { text, calls } = fake(body.question);
    state.turn = { id: randomUUID(), pending: calls.map(c => c.id), done: !calls.length };
    state.history.push({ role: 'tutor', text, at: new Date().toISOString() });
    return send(res, 200, { turn: state.turn.id, text, tool_calls: calls, done: state.turn.done });
  }
  if (url === '/api/tutor/continue' && req.method === 'POST') {
    const t = state.turn;
    const ok = exact(body, ['turn', 'results']) && Array.isArray(body.results) && t && !t.done && body.turn === t.id &&
      body.results.length === t.pending.length && body.results.every(r => exact(r, ['id', 'ok', 'output']) && typeof r.ok === 'boolean' && typeof r.output === 'string' && r.output.length <= 8000) &&
      new Set(body.results.map(r => r.id)).size === t.pending.length && t.pending.every(id => body.results.some(r => r.id === id));
    state.continues.push(body);
    if (!ok) return refuse(res, 400, 'bad_turn', 'Those tool results do not match this turn.');
    t.done = true; t.pending = [];
    const text = 'The map has updated. What do you notice about those rows?';
    state.history.push({ role: 'tutor', text, at: new Date().toISOString() });
    return send(res, 200, { turn: t.id, text, tool_calls: [], done: true });
  }
  if (url === '/api/receipt' && req.method === 'POST') {
    if (!exact(body, ['floor']) || ![1, 2, 3].includes(body.floor)) return refuse(res, 400, 'bad_request', 'Please choose a floor from 1 to 3.');
    const code = state.receipts[body.floor] ||= `TAXI-${body.floor}-${'ABCDEFGHJKLMNPQRSTUVWXYZ'.split('').sort(() => Math.random() - 0.5).slice(0, 8).join('')}`;
    return send(res, 200, { floor: body.floor, code });
  }
  if (url === '/api/forget' && req.method === 'POST') {
    if (!exact(body, [])) return refuse(res, 400, 'bad_request', 'That request has unexpected or missing fields.');
    state.history = []; state.turn = null;
    return send(res, 200, { ok: true });
  }
  return refuse(res, 404, 'bad_request', 'That page could not be found.');
}

async function file(res, base, rel) {
  const path = resolve(base, '.' + sep + decodeURIComponent(rel));
  if (path !== base && !path.startsWith(base + sep)) return refuse(res, 404, 'bad_request', 'Not found.');
  try {
    let p = path;
    if ((await stat(p)).isDirectory()) p = join(p, 'index.html');
    const data = await readFile(p);
    res.writeHead(200, { 'Content-Type': MIME[extname(p)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(data);
  } catch { refuse(res, 404, 'bad_request', 'Not found.'); }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = req.url.split('?')[0];
    let body;
    if (req.method === 'POST') {
      const chunks = []; for await (const c of req) chunks.push(c);
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null'); } catch { return refuse(res, 400, 'bad_request', 'Please send a valid request.'); }
    }
    if (url === '/healthz') { res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end('ok'); }
    if (url === '/__mock/log') return send(res, 200, { asks: state.asks, continues: state.continues, history: state.history, turn: state.turn });
    if (url === '/__mock/reset' && req.method === 'POST') { reset(); return send(res, 200, { ok: true }); }
    if (url === '/__mock/config' && req.method === 'POST') { Object.assign(state, body || {}); return send(res, 200, { ok: true }); }
    if (url.startsWith('/api/')) return await api(req, res, body);
    if (url.startsWith('/data/')) return await file(res, DATA, url.slice('/data/'.length));
    if (url.startsWith('/game/db/') || url.startsWith('/vendor/')) {
      if (DB_SITE) return await file(res, DB_SITE, url.slice(1));
      if (url === '/game/db/db.js') return await file(res, join(HERE, 'stub'), 'db.js');
      return refuse(res, 404, 'bad_request', 'Not found.');
    }
    if (url === '/learn' || url === '/game') { res.writeHead(301, { Location: url + '/' }); return res.end(); }
    return await file(res, SITE, url.slice(1));
  } catch (e) {
    refuse(res, 500, 'upstream_error', String(e?.message || e));
  }
});
server.listen(PORT, '127.0.0.1', () => console.log(`ui test server on http://127.0.0.1:${PORT}${DB_SITE ? ` (db from ${DB_SITE})` : ' (db stub)'}`));

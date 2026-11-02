// Acceptance contract for issue #33 (written by Claude; do not weaken).
const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { rerunFixture } = require('./helpers');

const KEY = 'synthetic-key-value-never-logged';
const BODY_SECRET = 'SYNTHETIC_PROVIDER_ERROR_TEXT';
const QUESTION = 'SYNTHETIC_LEARNER_QUESTION';
const ask = { question: QUESTION, page: '<page>floor1</page>' };
const usage = { input_tokens: 100, output_tokens: 30 };
const providerError = (status, type) => new Response(
  JSON.stringify({ type: 'error', error: { type, message: BODY_SECRET }, request_id: 'req_synthetic' }),
  { status, headers: { 'content-type': 'application/json' } },
);
const providerOk = content => new Response(
  JSON.stringify({ content, stop_reason: content.some(b => b.type === 'tool_use') ? 'tool_use' : 'end_turn', usage }),
  { status: 200, headers: { 'content-type': 'application/json' } },
);
// A live Tutor (FAKE_MODEL off) whose network is the injected fetch, so the real liveResponse runs.
const live = (t, fetchImpl) => rerunFixture(t, { env: { FAKE_MODEL: '0', ANTHROPIC_API_KEY: KEY }, fetchImpl });
const GAMES = [
  { name: 'Rerun', prefix: '/api/rerun', store: f => f.app.rerun.store },
  { name: 'pilot', prefix: '/api', store: f => f.app.store },
];

for (const game of GAMES) {
  // Breaks if a failed call still leaves a counted row in questions.
  test(`${game.name}: a provider rejection does not use a question or spend money`, async t => {
    const f = await live(t, async () => providerError(401, 'authentication_error'));
    const reply = await f.request(`${game.prefix}/tutor/ask`, ask);
    assert.equal(reply.status, 502);
    assert.equal(reply.body.error, 'upstream_error');
    assert.equal((await f.request(`${game.prefix}/me`)).body.tutor.questions_left, 40);
    // The provider does not bill a non-2xx reply, so the estimate must not stay against the caps.
    assert.equal(game.store(f).total(), 0);
    assert.equal(game.store(f).usage('dev').spent, 0);
  });

  // Breaks if a success stops being counted by an over-broad refund.
  test(`${game.name}: a question that gets an answer still uses one question`, async t => {
    const f = await live(t, async () => providerOk([{ type: 'text', text: 'Synthetic answer' }]));
    assert.equal((await f.request(`${game.prefix}/tutor/ask`, ask)).status, 200);
    assert.equal((await f.request(`${game.prefix}/me`)).body.tutor.questions_left, 39);
  });
}

// Breaks if the refund deletes the row and so frees failed calls from the rate limit:
// a browser retry loop would then call the provider without limit.
test('failed calls still count toward the four-per-minute rate limit', async t => {
  let calls = 0;
  const f = await live(t, async () => { calls++; return providerError(401, 'authentication_error'); });
  for (let i = 0; i < 4; i++) assert.equal((await f.request('/api/rerun/tutor/ask', ask)).status, 502);
  const limited = await f.request('/api/rerun/tutor/ask', ask);
  assert.equal(limited.status, 429);
  assert.equal(limited.body.error, 'cap_rate');
  assert.equal(calls, 4);
  assert.equal((await f.request('/api/rerun/me')).body.tutor.questions_left, 40);
  f.advance(61000);
  assert.equal((await f.request('/api/rerun/tutor/ask', ask)).status, 502);
});

// Breaks if a timeout frees money the provider may still bill (the existing ledger rule).
test('a network failure refunds the question but keeps the money reservation unknown', async t => {
  const f = await live(t, async () => { throw new Error('synthetic network failure'); });
  const reply = await f.request('/api/rerun/tutor/ask', ask);
  assert.equal(reply.status, 502);
  assert.equal((await f.request('/api/rerun/me')).body.tutor.questions_left, 40);
  const row = f.app.rerun.store.chat.prepare('SELECT status,amount FROM ledger').get();
  assert.equal(row.status, 'unknown');
  assert.ok(row.amount > 0);
});

// Breaks if only the first round of a turn can refund.
test('a failure on a later tool round refunds that question', async t => {
  let calls = 0;
  const f = await live(t, async () => (++calls === 1
    ? providerOk([{ type: 'tool_use', id: 'synthetic-look', name: 'look', input: {} }])
    : providerError(500, 'api_error')));
  const start = await f.request('/api/rerun/tutor/ask', ask);
  assert.equal(start.status, 200);
  assert.equal((await f.request('/api/rerun/me')).body.tutor.questions_left, 39);
  const end = await f.request('/api/rerun/tutor/continue', { turn: start.body.turn, results: [{ id: 'synthetic-look', ok: true, output: 'x' }] });
  assert.equal(end.status, 502);
  assert.equal((await f.request('/api/rerun/me')).body.tutor.questions_left, 40);
});

// Breaks if the learner again sees only "Please try again", or is told to retry a fault retries cannot fix.
test('the message says what happened, that no question was used, and when to retry', async t => {
  const cases = [
    [401, 'authentication_error', /later/i],
    [429, 'rate_limit_error', /minute/i],
    [529, 'overloaded_error', /minute/i],
    [500, 'api_error', /minute/i],
  ];
  for (const [status, type, when] of cases) {
    const f = await live(t, async () => providerError(status, type));
    const { message } = (await f.request('/api/rerun/tutor/ask', ask)).body;
    assert.match(message, /did not use/i, `${status}`);
    assert.match(message, when, `${status}`);
    assert.doesNotMatch(message, /Please try again\.$/, `${status}`);
    assert.ok(!message.includes(BODY_SECRET), `${status}`);
    assert.ok(!message.includes(type), `${status}`);
  }
});

// Breaks if the next failure is silent again, or if the log leaks the key or learner text.
test('a provider rejection is logged with status, type and request id only', async t => {
  const lines = [];
  t.mock.method(console, 'error', (...args) => { lines.push(args.map(String).join(' ')); });
  const f = await live(t, async () => providerError(401, 'authentication_error'));
  await f.request('/api/rerun/tutor/ask', ask);
  const log = lines.join('\n');
  assert.match(log, /401/);
  assert.match(log, /authentication_error/);
  assert.match(log, /req_synthetic/);
  for (const secret of [KEY, BODY_SECRET, QUESTION]) assert.ok(!log.includes(secret), secret);
});

// Breaks if a database made before this fix fails to open or loses its existing counts.
test('an existing database keeps its question counts after the upgrade', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'taxi-migrate-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'chat.sqlite');
  const old = new DatabaseSync(`${path}.rerun.sqlite`);
  old.exec('CREATE TABLE questions (quota TEXT, day TEXT, at INTEGER)');
  old.prepare('INSERT INTO questions VALUES (?,?,?)').run('dev', '2026-10-16', Date.parse('2026-10-16T21:00:00Z'));
  old.close();
  for (let open = 0; open < 2; open++) { // Twice: the upgrade must be safe to repeat.
    const { createApp } = require('../../server/index.js');
    const app = createApp({ env: { AUTH_MODE: 'dev', FAKE_MODEL: '1', DB_PATH: path, RERUN_OPENS_AT: '2026-10-16T00:00:00Z' }, now: () => Date.parse('2026-10-16T22:00:00Z') });
    assert.equal(app.rerun.store.usage('dev').questions, 1);
    await app.close();
  }
});

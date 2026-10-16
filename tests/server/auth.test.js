const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture } = require('./helpers');
const { readFileSync, statSync } = require('node:fs');
const question = { question: 'Synthetic test question', page: '' };
const joinEnv = { AUTH_MODE: 'join', JOIN_CODE: 'synthetic-class-code' };
function cookie(response) { return response.headers.get('set-cookie').split(';')[0]; }

// Break caught: trusting a browser identity while Easy Auth is disabled, or allowing dev on Azure.
test('Entra headers are trusted only behind enabled Easy Auth; dev refuses Azure startup', async t => {
  const f = await fixture(t, { env: { AUTH_MODE: 'entra' } });
  const forged = { 'x-ms-client-principal-id': 'synthetic-forged-subject' };
  for (const path of ['/api/me', '/api/tutor/history']) assert.equal((await f.request(path, undefined, forged)).status, 401);
  assert.equal((await f.request('/api/receipt', { floor: 1 }, forged)).status, 401);
  const { config } = require('../../server/config');
  assert.throws(() => config({ AUTH_MODE: 'dev', WEBSITE_SITE_NAME: 'synthetic-site' }), /local only/);
});

test('Entra creates private random sessions and keeps identity out of the chat store', async t => {
  const f = await fixture(t, { env: { AUTH_MODE: 'entra', WEBSITE_AUTH_ENABLED: 'True', WEBSITE_SITE_NAME: 'synthetic-site' } });
  const a = { 'x-ms-client-principal-id': 'synthetic-subject-a' };
  const b = { 'x-ms-client-principal-id': 'synthetic-subject-b' };
  const me = await f.request('/api/me', undefined, a);
  assert.equal(me.status, 200);
  assert.notEqual(me.body.session, 'synthetic-subject-a');
  assert.equal((await f.request('/api/me', undefined, a)).body.session, me.body.session);
  assert.notEqual((await f.request('/api/me', undefined, b)).body.session, me.body.session);
  await f.request('/api/tutor/ask', question, a);
  assert.equal((await f.request('/api/tutor/history', undefined, b)).body.messages.length, 0);
  assert.ok((await f.request('/api/tutor/history', undefined, a)).body.messages.length);
  for (const table of ['history', 'turns', 'ledger', 'questions', 'request_log']) {
    assert.ok(!JSON.stringify(f.app.store.chat.prepare(`SELECT * FROM ${table}`).all()).includes('synthetic-subject-a'));
  }
});

test('join code issues a protected cookie and ignores forged identity and cookie values', async t => {
  const f = await fixture(t, { env: joinEnv });
  assert.equal((await f.request('/api/join', { code: 'wrong' })).status, 401);
  assert.equal((await f.request('/api/me')).status, 401);
  const joined = await f.request('/api/join', { code: 'synthetic-class-code' });
  assert.equal(joined.status, 200);
  const set = joined.headers.get('set-cookie');
  for (const flag of ['HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/']) assert.ok(set.includes(flag));
  assert.equal((await f.request('/api/me', undefined, { cookie: cookie(joined) })).status, 200);
  assert.equal((await f.request('/api/me', undefined, { cookie: 'tc_session=forged', 'x-ms-client-principal-id': 'forged' })).status, 401);
  assert.ok(!cookie(joined).includes(joined.body.session));
});

test('join caps enforce ten per minute and 120 ever, even after forgetting', async t => {
  const f = await fixture(t, { env: joinEnv });
  for (let i = 0; i < 120; i++) {
    if (i && i % 10 === 0) f.advance(60001);
    const r = await f.request('/api/join', { code: 'synthetic-class-code' });
    assert.equal(r.status, 200, `join ${i}`);
    if (i === 0) assert.equal((await f.request('/api/forget', {}, { cookie: cookie(r) })).status, 200);
    if (i === 9) assert.equal((await f.request('/api/join', { code: 'synthetic-class-code' })).body.error, 'cap_rate');
  }
  f.advance(60001);
  assert.equal((await f.request('/api/join', { code: 'synthetic-class-code' })).body.error, 'cap_questions');
});

test('forget clears chat and cookie, revokes join sessions, and preserves spend and receipts', async t => {
  const f = await fixture(t, { env: joinEnv });
  const joined = await f.request('/api/join', { code: 'synthetic-class-code' });
  const headers = { cookie: cookie(joined) };
  await f.request('/api/tutor/ask', question, headers);
  const receipt = await f.request('/api/receipt', { floor: 1 }, headers);
  const before = f.app.store.total();
  const forgotten = await f.request('/api/forget', {}, headers);
  assert.equal(forgotten.status, 200);
  assert.match(forgotten.headers.get('set-cookie'), /Max-Age=0/);
  assert.equal((await f.request('/api/me', undefined, headers)).status, 401);
  assert.equal(f.app.store.history(joined.body.session).length, 0);
  assert.equal(f.app.store.turn(joined.body.session), null);
  assert.equal(f.app.store.total(), before);
  assert.equal(f.app.store.receipt(joined.body.session, 1).code, receipt.body.code);
  assert.ok(!readFileSync(f.env.DB_PATH).includes(Buffer.from('Synthetic test question')));
  assert.equal(statSync(f.env.DB_PATH).mode & 0o777, 0o600);
  assert.equal(statSync(`${f.env.DB_PATH}.identity.sqlite`).mode & 0o777, 0o600);
});

test('forget cannot reset the daily cap of an Entra learner', async t => {
  const f = await fixture(t, { env: { AUTH_MODE: 'entra', WEBSITE_AUTH_ENABLED: 'true', WEBSITE_SITE_NAME: 'synthetic-site', CAP_QUESTIONS: '1' } });
  const headers = { 'x-ms-client-principal-id': 'synthetic-subject-a' };
  const first = (await f.request('/api/me', undefined, headers)).body.session;
  await f.request('/api/tutor/ask', question, headers);
  assert.equal((await f.request('/api/forget', {}, headers)).status, 200);
  assert.notEqual((await f.request('/api/me', undefined, headers)).body.session, first);
  assert.equal((await f.request('/api/tutor/ask', question, headers)).body.error, 'cap_questions');
});

test('rejects cross-site and non-JSON mutations', async t => {
  const f = await fixture(t);
  const cross = await f.request('/api/receipt', { floor: 1 }, { origin: 'https://unrelated.invalid', 'sec-fetch-site': 'cross-site' });
  assert.equal(cross.status, 403);
  const form = await fetch(f.base + '/api/receipt', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{"floor":1}' });
  assert.equal(form.status, 415);
  const same = await f.request('/api/receipt', { floor: 1 }, { origin: f.base });
  assert.equal(same.status, 200);
});

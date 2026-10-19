const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture } = require('./helpers');
const { config, rerunConfig } = require('../../server/config');
const OPEN = Date.parse('2026-10-23T05:00:00Z');
const trusted = { AUTH_MODE: 'entra', WEBSITE_SITE_NAME: 'synthetic', WEBSITE_AUTH_ENABLED: 'true' };
const identity = (name = 'tester@example.invalid') => ({ 'x-ms-client-principal-id': 'synthetic-owner', 'x-ms-client-principal-name': name });
const question = { question: 'What should I predict?', page: '' };

async function denied(f, headers = {}) {
  for (const [path, body] of [['check', {floor:1}], ['receipt', {floor:1}], ['tutor/ask', question], ['tutor/continue', {}], ['tutor/history', undefined]]) {
    const r = await f.request('/api/rerun/' + path, body, headers);
    assert.equal(r.status, 403, path); assert.equal(r.body.error, 'rerun_not_open', path);
  }
  assert.equal(f.app.rerun.store.total(), 0);
  assert.equal(f.app.rerun.store.identity.prepare('SELECT count(*) AS n FROM receipts').get().n, 0);
}

test('Rerun defaults to Friday midnight CDT, empty early access, validates an override', () => {
  const cfg = rerunConfig(config({AUTH_MODE:'dev',DB_PATH:'/tmp/synthetic-config.sqlite'}));
  assert.equal(cfg.opensAt, '2026-10-23T05:00:00.000Z');
  assert.equal(cfg.earlyAccess.size, 0);
  assert.equal(rerunConfig(config({RERUN_OPENS_AT:'2026-10-24T05:00:00Z'})).opensAt, '2026-10-24T05:00:00.000Z');
  assert.throws(() => rerunConfig(config({RERUN_OPENS_AT:'invalid'})), /Invalid RERUN_OPENS_AT/);
});

test('before opening the plain page, assets and all protected Rerun actions are gated; pilot unchanged', async t => {
  const f = await fixture(t);
  await denied(f);
  const page = await fetch(f.base+'/rerun/');
  const html = await page.text();
  assert.equal(page.status, 200); assert.equal(page.headers.get('cache-control'), 'no-store');
  assert.match(html, /The Rerun opens Friday, October 23\. Come back then\./);
  assert.match(html, /1% extra credit for all three floors plus one improvement issue/);
  assert.match(html, /October 26.*11:59 PM CDT/);
  assert.doesNotMatch(html, /<script|id="pipeline"/);
  const head = await fetch(f.base+'/rerun/', {method:'HEAD'});
  assert.equal(head.headers.get('content-length'), String(Buffer.byteLength(html)));
  assert.equal(await head.text(), '');
  for (const path of ['/rerun/index.html', '/%72erun/index.html']) {
    const r = await fetch(f.base+path); assert.match(await r.text(), /Come back then/);
  }
  for (const path of ['//rerun/index.html', '/rerun/app.js', '/%72erun/db/db.js', '/data/rerun/day1.parquet', '/data/%72erun/reference/floor1.sql']) {
    const r = await fetch(f.base+path); assert.equal(r.status, 403, path);
  }
  assert.equal((await f.request('/api/tutor/ask', question)).status, 200);
  assert.equal((await f.request('/api/receipt', {floor:1})).status, 200);
  assert.match(await (await fetch(f.base+'/learn/')).text(), /Taxi/);
  assert.equal((await f.request('/api/rerun/me')).body.tutor.open, false);
  assert.equal((await f.request('/api/rerun/forget', {})).status, 200);
});

test('opening boundary uses server time; no exemption required at or after opening', async t => {
  const f = await fixture(t, {now:undefined});
  f.advance(OPEN - Date.parse('2026-10-16T22:00:00Z') - 1);
  await denied(f);
  f.advance(1);
  for (const increment of [0, 1000]) {
    f.advance(increment);
    assert.equal((await f.request('/api/rerun/check', {floor:1})).status, 200);
    assert.equal((await f.request('/api/rerun/receipt', {floor:1})).status, 200);
    assert.equal((await f.request('/api/rerun/tutor/ask', question)).status, 200);
    assert.match(await (await fetch(f.base+'/rerun/')).text(), /id="pipeline"/);
  }
  assert.equal((await f.request('/api/rerun/check', {floor:4})).status, 400);
});

test('early access matches only the trusted signed-in principal name, case-insensitively', async t => {
  const f = await fixture(t, {env:{...trusted, RERUN_EARLY_ACCESS:' , TESTER@EXAMPLE.INVALID, other@example.invalid , '}});
  const headers = identity('Tester@Example.Invalid');
  assert.equal((await f.request('/api/rerun/check', {floor:3}, headers)).status, 200);
  assert.equal((await f.request('/api/rerun/receipt', {floor:3}, headers)).status, 200);
  assert.equal((await f.request('/api/rerun/tutor/ask', question, headers)).status, 200);
  const page = await fetch(f.base+'/rerun/', {headers});
  assert.match(await page.text(), /id="pipeline"/); assert.equal(page.headers.get('cache-control'), 'no-store');
  const me = await f.request('/api/rerun/me', undefined, headers);
  assert.equal(me.body.tutor.open, true);
  assert.doesNotMatch(JSON.stringify(me.body), /example.invalid|earlyAccess|EARLY_ACCESS/i);
  for (const name of ['someone@example.invalid', 'prefix-tester@example.invalid', 'tester@example.invalid,other@example.invalid', '']) {
    assert.equal((await f.request('/api/rerun/check', {floor:1}, identity(name))).status, 403);
  }
  assert.equal((await f.request('/api/rerun/check', {floor:1}, {'x-ms-client-principal-name':'tester@example.invalid'})).status, 401);
  assert.equal((await f.request('/api/rerun/check', {floor:1}, {'x-ms-client-principal-id':'tester@example.invalid'})).status, 403);
  const anonymous = await fetch(f.base+'/rerun/'); assert.match(await anonymous.text(), /Come back then/);
  const untrusted = await fixture(t, {env:{AUTH_MODE:'entra',RERUN_EARLY_ACCESS:'tester@example.invalid'}});
  assert.equal((await untrusted.request('/api/rerun/check', {floor:1}, headers)).status, 401);
});

test('dev exemption uses synthetic dev identity; join cookies and supplied names cannot impersonate it', async t => {
  const dev = await fixture(t, {env:{RERUN_EARLY_ACCESS:' DeV '}});
  assert.equal((await dev.request('/api/rerun/check', {floor:1}, identity('not-listed@example.invalid'))).status, 200);
  const other = await fixture(t, {env:{RERUN_EARLY_ACCESS:'tester@example.invalid'}});
  await denied(other, identity());
  const joined = await fixture(t, {env:{AUTH_MODE:'join',JOIN_CODE:'synthetic',RERUN_EARLY_ACCESS:'tester@example.invalid,dev'}});
  const login = await joined.request('/api/join', {code:'synthetic'});
  await denied(joined, {...identity(),cookie:login.headers.get('set-cookie').split(';')[0]});
});

test('early access does not override tutor-off or the closing deadline', async t => {
  const off = await fixture(t, {env:{RERUN_EARLY_ACCESS:'dev',TUTOR_OFF:'1'}});
  assert.equal((await off.request('/api/rerun/tutor/ask', question)).body.error, 'tutor_off');
  const closed = await fixture(t, {env:{RERUN_EARLY_ACCESS:'dev'},now:()=>Date.parse('2026-10-27T04:59:00Z')});
  assert.equal((await closed.request('/api/rerun/receipt', {floor:1})).body.error, 'tutor_closed');
});

test('custom opening time controls the notice and enforcement together', async t => {
  const f = await fixture(t, {env:{RERUN_OPENS_AT:'2026-10-24T05:00:00Z'},now:()=>OPEN});
  const page = await fetch(f.base+'/rerun/');
  assert.match(await page.text(), /The Rerun opens Saturday, October 24\. Come back then\./);
  assert.equal((await f.request('/api/rerun/check', {floor:1})).status, 403);
});

test('resolved Rerun files remain protected through symlink aliases', async t => {
  const {mkdtempSync,mkdirSync,writeFileSync,symlinkSync,rmSync} = require('node:fs');
  const {join} = require('node:path');
  const dir = mkdtempSync(join(require('node:os').tmpdir(),'rerun-access-alias-'));
  const site = join(dir,'site'), data = join(dir,'data');
  mkdirSync(join(site,'rerun'),{recursive:true});mkdirSync(join(data,'rerun'),{recursive:true});
  writeFileSync(join(site,'rerun','index.html'),'synthetic full game');
  writeFileSync(join(site,'rerun','app.js'),'synthetic game script');
  writeFileSync(join(data,'rerun','day1.parquet'),'synthetic data');
  symlinkSync(join(site,'rerun','index.html'),join(site,'preview.html'));
  symlinkSync(join(site,'rerun','app.js'),join(site,'preview.js'));
  symlinkSync(join(data,'rerun','day1.parquet'),join(data,'preview.parquet'));
  const f = await fixture(t, {siteRoot:site,dataRoot:data});
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  assert.match(await (await fetch(f.base+'/preview.html')).text(), /Come back then/);
  for(const path of ['/preview.js','/data/preview.parquet']) assert.equal((await fetch(f.base+path)).status,403);
});

const exchangeQuestion = {question:'What does the current row count tell us?',page:'<page>floor: 1; day: 1</page>'};
const exchangeAction = {id:'synthetic-trip-count',name:'run_sql',input:{sql:'SELECT COUNT(*) AS trips FROM raw_trips'}};
const exchangeIntro = 'I will check the current row count.';
const exchangeReply = 'There are 2400 loads. What do you predict a second run will do?';
const exchangeOutput = '{"columns":["trips"],"rows":[[2400]]}';
function exchangeModel() {
  const observed = [];
  return { observed, model:async payload => {
    observed.push(structuredClone(payload));
    return {
      stop_reason:observed.length === 1 ? 'tool_use' : 'end_turn',
      content:observed.length === 1
        ? [{type:'text',text:exchangeIntro},{type:'tool_use',...exchangeAction}]
        : [{type:'text',text:exchangeReply}],
      usage:{input_tokens:100,output_tokens:30},
    };
  }};
}
async function startExchange(f, headers, observed) {
  const ask = await f.request('/api/rerun/tutor/ask', exchangeQuestion, headers);
  assert.equal(ask.status, 200);
  assert.equal(ask.body.done, false);
  assert.equal(ask.body.text, exchangeIntro);
  assert.deepEqual(ask.body.tool_calls, [exchangeAction]);
  assert.equal(observed.length, 1);
  // The browser returns this synthetic tool result, using the action ID actually issued.
  return {turn:ask.body.turn,results:[{id:ask.body.tool_calls[0].id,ok:true,output:exchangeOutput}]};
}
async function finishExchange(f, headers, continuation, observed) {
  const done = await f.request('/api/rerun/tutor/continue', continuation, headers);
  assert.equal(done.status, 200);
  assert.equal(done.body.turn, continuation.turn);
  assert.equal(done.body.done, true);
  assert.equal(done.body.text, exchangeReply);
  assert.deepEqual(done.body.tool_calls, []);
  assert.equal(observed.length, 2);
  assert.deepEqual(observed[1].messages.at(-1), {
    role:'user',content:[{type:'tool_result',tool_use_id:exchangeAction.id,content:exchangeOutput,is_error:false}],
  });
}

test('listed learner completes a tutor tool exchange and retrieves its history before opening', async t => {
  const {model,observed} = exchangeModel();
  const f = await fixture(t, {model,env:{...trusted,RERUN_EARLY_ACCESS:'TESTER@EXAMPLE.INVALID'},now:()=>OPEN-1});
  const headers = identity('Tester@Example.Invalid');
  const continuation = await startExchange(f, headers, observed);
  await finishExchange(f, headers, continuation, observed);
  const spent = f.app.rerun.store.total();
  const history = await f.request('/api/rerun/tutor/history', undefined, headers);
  assert.equal(history.status, 200);
  assert.deepEqual(history.body.messages.map(({role,text})=>({role,text})), [
    {role:'learner',text:exchangeQuestion.question},
    {role:'tutor',text:exchangeIntro},
    {role:'tutor',text:exchangeReply},
  ]);
  assert.equal(observed.length, 2, 'history retrieval does not call the model');
  assert.equal(f.app.rerun.store.total(), spent, 'history retrieval spends nothing');
});

for (const [label,time] of [['at',OPEN],['after',OPEN+1]]) {
  test(`unlisted learner completes a tutor tool exchange ${label} opening`, async t => {
    const {model,observed} = exchangeModel();
    const f = await fixture(t, {model,env:{...trusted,RERUN_EARLY_ACCESS:'other@example.invalid'},now:()=>time});
    const headers = identity('unlisted@example.invalid');
    const continuation = await startExchange(f, headers, observed);
    await finishExchange(f, headers, continuation, observed);
  });
}

test('removing early access refuses a valid pending continuation without consuming it', async t => {
  const {model,observed} = exchangeModel();
  const f = await fixture(t, {model,env:{...trusted,RERUN_EARLY_ACCESS:'tester@example.invalid'},now:()=>OPEN-1});
  const headers = identity();
  const continuation = await startExchange(f, headers, observed);
  const me = await f.request('/api/rerun/me', undefined, headers);
  const session = me.body.session;
  const pending = f.app.rerun.store.turn(session), spent = f.app.rerun.store.total();
  assert.equal(pending.done, false);
  assert.equal(pending.id, continuation.turn);
  f.app.rerun.config.earlyAccess.clear();
  const refused = await f.request('/api/rerun/tutor/continue', continuation, headers);
  assert.equal(refused.status, 403);
  assert.equal(refused.body.error, 'rerun_not_open');
  assert.equal(observed.length, 1, 'refusal must happen before calling the model');
  assert.equal(f.app.rerun.store.total(), spent, 'refusal must not spend money');
  assert.deepEqual(f.app.rerun.store.turn(session), pending, 'refusal must leave the valid turn pending');
  f.app.rerun.config.earlyAccess.add('tester@example.invalid');
  await finishExchange(f, headers, continuation, observed);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const { writeFileSync } = require('node:fs');
const { dirname, join } = require('node:path');
const { spawnSync } = require('node:child_process');
const { fixture } = require('./helpers');

// Break caught: receipt existence alone passing another learner's Entra code, or duplicate code reuse.
test('code verifier binds Entra ownership and flags codes used by multiple learners', async t => {
  const f = await fixture(t, { env: { AUTH_MODE: 'entra', WEBSITE_AUTH_ENABLED: 'true', WEBSITE_SITE_NAME: 'synthetic-site' } });
  const headers = { 'x-ms-client-principal-id': 'synthetic-object-a' };
  const codes = [];
  for (let floor = 1; floor <= 3; floor++) codes.push((await f.request('/api/receipt', { floor }, headers)).body.code);
  const csv = join(dirname(f.env.DB_PATH), 'codes.csv');
  writeFileSync(csv, `learner,entra_id,codes\n"Synthetic, Learner A",synthetic-object-a,"${codes.join(' ')}"\nSynthetic Learner B,synthetic-object-b,${codes[0]}\nSynthetic Learner C,synthetic-object-c,TAXI-1-ZZZZZZZZ\n`);
  const result = spawnSync(process.execPath, [join(__dirname, '../../server/verify-codes.js'), csv], {
    cwd: f.app.config.root, env: { ...process.env, DB_PATH: f.env.DB_PATH }, encoding: 'utf8',
  });
  assert.equal(result.status, 1, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.learners.find(x => x.learner === 'Synthetic, Learner A').complete, false);
  assert.equal(report.records.filter(r => r.learner === 'Synthetic, Learner A').length, 3);
  assert.ok(report.records.some(r => r.flags.includes('wrong_owner')));
  assert.ok(report.records.some(r => r.flags.includes('unknown_code')));
  assert.equal(report.duplicates.length, 1);
  assert.equal(report.duplicates[0].code, codes[0]);
  assert.equal(report.duplicates[0].learners.length, 2);
});

test('three owned codes pass, while join codes report their limited ownership evidence', async t => {
  const f = await fixture(t);
  const codes = [];
  for (let floor = 1; floor <= 3; floor++) codes.push((await f.request('/api/receipt', { floor })).body.code);
  f.app.store.identity.prepare("UPDATE sessions SET mode='join' WHERE id='dev'").run();
  const csv = join(dirname(f.env.DB_PATH), 'codes.csv');
  writeFileSync(csv, `learner,code\nSynthetic Learner,${codes[0]}\nSynthetic Learner,${codes[1]}\nSynthetic Learner,${codes[2]}\n`);
  const result = spawnSync(process.execPath, [join(__dirname, '../../server/verify-codes.js'), csv], { env: { ...process.env, DB_PATH: f.env.DB_PATH }, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.learners[0].complete, true);
  assert.ok(report.records.every(r => r.ownership === 'session_only'));
  assert.ok(report.records.every(r => r.flags.length === 0));
});

test('three Entra-owned codes pass and malformed CSV exits with a bounded error', async t => {
  const f = await fixture(t, { env: { AUTH_MODE: 'entra', WEBSITE_AUTH_ENABLED: 'true', WEBSITE_SITE_NAME: 'synthetic-site' } });
  const codes = [];
  for (let floor = 1; floor <= 3; floor++) codes.push((await f.request('/api/receipt', { floor }, { 'x-ms-client-principal-id': 'synthetic-owner' })).body.code);
  const csv = join(dirname(f.env.DB_PATH), 'codes.csv');
  writeFileSync(csv, `learner,entra_id,codes\r\nSynthetic Learner,synthetic-owner,"${codes.join('\n')}"\r\n`);
  const run = () => spawnSync(process.execPath, [join(__dirname, '../../server/verify-codes.js'), csv], { env: { ...process.env, DB_PATH: f.env.DB_PATH }, encoding: 'utf8' });
  const success = run();
  assert.equal(success.status, 0, success.stderr);
  assert.equal(JSON.parse(success.stdout).learners[0].complete, true);
  writeFileSync(csv, 'learner,code\n"Synthetic private marker');
  const bad = run();
  assert.equal(bad.status, 2);
  assert.equal(bad.stdout, '');
  assert.ok(!bad.stderr.includes('Synthetic private marker'));
});

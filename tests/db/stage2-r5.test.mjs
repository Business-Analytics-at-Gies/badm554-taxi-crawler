import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { openDb } from './harness.mjs';

let h;
before(async () => { h = await openDb(); await h.call('init'); });
after(async () => {
  assert.deepEqual(h.external, []);
  assert.deepEqual(h.errors, []);
  await h.close();
});
const fresh = async () => { await h.call('loadFloor', 1); await h.call('restartFloor', 1); };
const names = help => help.columns.map(c => c.name);

// Wrong source selection would silently suggest the changed Scratch schema to Answer.
test('R5 Answer column help stays pristine after Scratch replaces and drops trips_raw', async () => {
  await fresh();
  const pristine = await h.call('inspect', 'trips_raw');
  for (const mutation of ['CREATE OR REPLACE TABLE trips_raw AS SELECT 7 AS workspace_only', 'DROP TABLE trips_raw']) {
    await h.call('query', mutation);
    const r = await h.call('queryAnswer', 'SELECT VendorID FROM trips_raw');
    assert.match(r.error, /VendorID/);
    assert.equal(r.errorHelp.length, 1);
    assert.equal(r.errorHelp[0].table, 'trips_raw');
    assert.deepEqual(r.errorHelp[0].columns, pristine.columns);
    const scratch = await h.call('query', 'SELECT VendorID FROM trips_raw');
    if (mutation.startsWith('DROP')) assert.match(scratch.errorHelp[0].error, /does not exist/i);
    else assert.deepEqual(names(scratch.errorHelp[0]), ['workspace_only']);
  }
});

for (const [label, sql, tables] of [
  ['bare name', 'SELECT VendorID FROM trips_raw', ['trips_raw']],
  ['aliased join', 'SELECT t.VendorID FROM trips_raw t LEFT JOIN zones z ON t.pu_location_id = z.location_id', ['trips_raw', 'zones']],
  ['CTE', 'WITH rides AS (SELECT * FROM trips_raw) SELECT VendorID FROM rides', ['trips_raw']],
  ['same-named CTE', 'WITH trips_raw AS (SELECT * FROM trips_raw) SELECT VendorID FROM trips_raw', ['trips_raw']],
]) for (const method of ['query', 'queryAnswer']) {
  test(`R5 ${method} column help resolves ${label} to its underlying tables`, async () => {
    await fresh();
    const r = await h.call(method, sql);
    assert.match(r.error, /VendorID/);
    assert.deepEqual(r.errorHelp.map(t => t.table), tables);
    assert.ok(names(r.errorHelp[0]).includes('vendor_id'));
    assert.equal((await h.call('history')).length, 1, 'help adds no run');
    assert.equal((await h.call('state')).lastQueries.length, 1, 'help adds no tutor record');
  });
}

test('R5 learner-created columns and the failing second statement are inspected afresh', async () => {
  await fresh();
  const r = await h.call('query', 'CREATE TABLE notes AS SELECT 1 AS memo; SELECT VendorID FROM notes');
  assert.match(r.error, /VendorID/);
  assert.deepEqual(r.errorHelp.map(t => t.table), ['notes']);
  assert.deepEqual(names(r.errorHelp[0]), ['memo']);
  assert.equal((await h.call('history')).length, 1);
  assert.deepEqual((await h.call('query', 'SELECT * FROM notes')).rows, [[1]]);
});

test('R5 quiet help respects uncommitted replacement without aborting or committing Scratch', async () => {
  await fresh();
  await h.call('query', 'BEGIN; CREATE OR REPLACE TABLE trips_raw AS SELECT 7 AS pending_column');
  const failed = await h.call('query', 'SELECT VendorID FROM trips_raw');
  assert.deepEqual(names(failed.errorHelp[0]), ['pending_column']);
  // Inspecting metadata must not evaluate another query inside the open transaction.
  const before = { state: await h.call('state'), history: await h.call('history') };
  assert.deepEqual(names(await h.call('inspect', 'trips_raw')), ['pending_column']);
  const pristine = await h.call('inspect', 'trips_raw', { source: 'answer' });
  assert.ok(names(pristine).includes('vendor_id'));
  assert.deepEqual(await h.call('state'), before.state);
  assert.deepEqual(await h.call('history'), before.history);
  await h.call('query', 'ROLLBACK');
  assert.ok(names(await h.call('inspect', 'trips_raw')).includes('vendor_id'));
});

test('R5 column help excludes CTE aliases, strings, comments and hidden qualified tables', async () => {
  await fresh();
  const r = await h.call('query', "WITH rides AS (SELECT * FROM trips_raw) SELECT VendorID, 'FROM zones' FROM rides -- JOIN ghost");
  assert.deepEqual(r.errorHelp.map(t => t.table), ['trips_raw']);
  for (const source of ['scratch', 'answer']) {
    assert.equal((await h.call('inspect', '_base.trips_raw', { source })).ok, false);
  }
  assert.equal((await h.call('inspect', 'answers', { source: 'answer' })).ok, false);
  const syntax = await h.call('query', 'SELEC * FROM trips_raw');
  assert.equal(syntax.errorHelp, undefined);
  const shadow = await h.call('query', 'WITH trips_raw AS (SELECT 1 AS memo) SELECT VendorID FROM trips_raw');
  assert.deepEqual(shadow.errorHelp, [], 'a CTE with no physical input must not suggest the workspace table');
  const hidden = await h.call('query', 'SELECT VendorID FROM _base.trips_raw');
  assert.deepEqual(hidden.errorHelp, [], 'help must not inspect a different schema by its final name');
});

test('R5 Check floor explains Answer column errors without adding any query record', async () => {
  await fresh();
  await h.call('query', 'DROP TABLE trips_raw');
  const before = { state: await h.call('state'), history: await h.call('history') };
  const checked = await h.call('check', 1, 'SELECT VendorID FROM trips_raw');
  assert.equal(checked.pass, false);
  assert.match(checked.error, /VendorID/);
  assert.ok(names(checked.errorHelp[0]).includes('vendor_id'));
  assert.deepEqual(await h.call('state'), before.state);
  assert.deepEqual(await h.call('history'), before.history);
});

test('R5 checking another loaded floor uses that floor’s pristine columns for help', async () => {
  await fresh();
  await h.call('loadFloor', 2);
  const checked = await h.call('check', 1, 'SELECT VendorID FROM trips_raw');
  assert.match(checked.error, /VendorID/);
  assert.equal(checked.errorHelp[0].table, 'trips_raw');
  assert.ok(names(checked.errorHelp[0]).includes('vendor_id'));
  assert.equal((await h.call('state')).floor, 2);
});

test('R5 learner history labels both sources and keeps full text apart from the short tutor record', async () => {
  await fresh();
  for (const [method, source] of [['query', 'scratch'], ['queryAnswer', 'answer']]) {
    const sql = ` \nSELECT 42 AS n /* ${'long'.repeat(400)} */\n `;
    await h.call(method, sql);
    const entry = (await h.call('history')).at(-1);
    assert.equal(entry.source, source);
    assert.equal(entry.sql, sql);
    assert.equal((await h.call('state')).lastQueries.at(-1).sql.length, 1000);
  }
});

for (const method of ['query', 'queryAnswer']) test(`R5 ${method} failed and cancelled runs remain in history`, async () => {
  await fresh();
  await h.call(method, 'SELECT VendorID FROM trips_raw');
  const sql = 'SELECT sum(range % 7) FROM range(20000000000) WHERE range % 13 = 1';
  const pending = h.call(method, sql);
  await h.page.waitForTimeout(300);
  assert.equal((await h.call('cancel')).ok, true);
  const cancelled = await pending;
  assert.match(cancelled.error, /stopped|cancel|interrupt/i);
  const entries = await h.call('history');
  assert.equal(entries.length, 2);
  assert.equal(entries[0].source, method === 'query' ? 'scratch' : 'answer');
  assert.match(entries[0].error, /VendorID/);
  assert.equal(entries[1].sql, sql);
  assert.equal(entries[1].error, cancelled.error);
  assert.equal(entries[1].rowCount, null);
});

test('R5 cancelling the first Answer run while its worker starts records a cancellation', async () => {
  const cold = await openDb();
  try {
    await cold.call('init'); await cold.call('loadFloor', 1);
    const out = await cold.page.evaluate(async () => {
      const pending = window.db.queryAnswer('SELECT sum(range % 7) FROM range(20000000000)', { timeoutMs: 100 });
      const cancellation = await window.db.cancel();
      return { cancellation, result: await pending, history: await window.db.history() };
    });
    assert.equal(out.cancellation.ok, true);
    assert.equal(out.result.error, 'Query stopped.');
    assert.equal(out.history.length, 1);
    assert.equal(out.history[0].source, 'answer');
    assert.equal(out.history[0].error, 'Query stopped.');
  } finally { await cold.close(); }
});

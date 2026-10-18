import assert from 'node:assert/strict';
import { test } from 'node:test';
import { changesState, forbiddenReference, isReadOnly, keywords, splitStatements } from '../../site/game/db/sql.js';
import { SQL_CASES } from './sql-cases.mjs';

for (const c of SQL_CASES) test(`shared splitter: ${c.name}`, () => {
  assert.deepEqual(splitStatements(c.sql), c.statements);
});

test('shared scanner: arbitrarily nested comments are ignored by keyword and reference guards', () => {
  const comment = `/* outer /* nested /* deeper; */ DELETE FROM hidden.bad; */ INSERT; */`;
  assert.deepEqual(splitStatements(`${comment}; -- ending\n/* still /* comment; */ only */`), []);
  assert.deepEqual(keywords(`${comment} SELECT 1`, 10), ['SELECT']);
  assert.equal(isReadOnly(`${comment} SELECT 1`), true);
  assert.equal(changesState(`${comment} CREATE TABLE x AS SELECT 1`), true);
  assert.equal(forbiddenReference(`${comment} SELECT 1`, ['hidden']), null);
  assert.equal(forbiddenReference(`${comment} SELECT * FROM hidden.actual`, ['hidden']), 'hidden');
});

test('shared scanner: escaped E-string text does not hide or invent references after it', () => {
  const quoted = String.raw`E'it\'s; hidden.fake query('`;
  assert.equal(forbiddenReference(`SELECT ${quoted}`, ['hidden']), null);
  assert.equal(forbiddenReference(`SELECT ${quoted} FROM hidden.actual`, ['hidden']), 'hidden');
  assert.equal(forbiddenReference(`SELECT ${quoted}, query('SELECT 1')`, ['hidden']), 'query');
  assert.deepEqual(keywords(`SELECT ${quoted}`, 10), ['SELECT']);
});

test('shared scanner: dollar-quote markers inside unquoted identifiers are not string openers', () => {
  assert.deepEqual(splitStatements('SELECT value$tag$name; SELECT 2;'), ['SELECT value$tag$name', 'SELECT 2']);
  assert.equal(forbiddenReference('SELECT value$tag$name FROM hidden.actual', ['hidden']), 'hidden');
});

test('shared scanner: quoted identifiers still expose actual forbidden schema references', () => {
  assert.equal(forbiddenReference('SELECT "safe;""id" FROM "hidden"."actual;"', ['hidden']), 'hidden');
  assert.deepEqual(splitStatements('SELECT "path\\"; SELECT 2;'), ['SELECT "path\\"', 'SELECT 2']);
});

test('shared scanner: CR terminates line comments, matching the vendored DuckDB parser', () => {
  assert.deepEqual(splitStatements('-- ignored;\rSELECT 1; -- ignored too;\rSELECT 2;'),
    ['-- ignored;\rSELECT 1', '-- ignored too;\rSELECT 2']);
  assert.equal(forbiddenReference('-- comment\rSELECT * FROM hidden.actual', ['hidden']), 'hidden');
  assert.equal(isReadOnly('-- comment\rDELETE FROM note'), false);
});

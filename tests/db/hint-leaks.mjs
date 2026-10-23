// Test-only oracle: complete authored outlines, actually run each variant, and
// submit every runnable variant to the same isolated answer grader as the UI.
import { readFile } from 'node:fs/promises';
const qi = name => `"${name.replaceAll('"', '""')}"`;
const quote = value => `'${value.replaceAll("'", "''")}'`;
export async function hintCandidates(h, pack) {
  const candidates = new Set();
  // Legacy check diagnostics are displayed by selected rungs too. Include their
  // numeric constants; extra numeric candidates only strengthen this oracle.
  const diagnostics = await readFile(new URL(`../../site${pack.check}`, import.meta.url), 'utf8');
  const text = [pack.task, pack.guideTask, pack.rulesText, JSON.stringify(pack.hints), diagnostics].join(' ');
  for (const number of text.matchAll(/\b\d[\d,]*(?:\.\d+)?\b/g)) candidates.add(number[0].replaceAll(',', ''));
  for (const table of Object.keys(pack.given)) {
    const inspected = await h.call('inspect', table);
    if (!inspected.ok) throw new Error(inspected.error);
    for (const column of inspected.columns) {
      candidates.add(qi(column.name));
      candidates.add(`${qi(table)}.${qi(column.name)}`);
      const count = await h.call('query', `SELECT count(DISTINCT ${qi(column.name)}) FROM ${qi(table)}`);
      if (count.error) throw new Error(count.error);
      if (Number(count.rows[0][0]) > 50) continue;
      // Convert to text in DuckDB, not JavaScript: timestamps retain all precision.
      const values = await h.call('query', `SELECT DISTINCT CAST(${qi(column.name)} AS VARCHAR) FROM ${qi(table)}`);
      if (values.error || values.truncated) throw new Error(values.error ?? 'Truncated distinct-value inventory');
      for (const [value] of values.rows) candidates.add(`CAST(${value === null ? 'NULL' : quote(value)} AS ${column.type})`);
    }
  }
  return [...candidates];
}

async function blankClauseRemovals(h, sql) {
  const tokens = await h.page.evaluate(async sql => {
    if (!window.hintTokenConnection) {
      const duck = await import('/vendor/duckdb/duckdb-browser.mjs');
      const worker = new Worker('/vendor/duckdb/duckdb-browser-eh.worker.js');
      const db = new duck.AsyncDuckDB(new duck.VoidLogger(), worker);
      await db.instantiate('/vendor/duckdb/duckdb-eh.wasm');
      window.hintTokenConnection = await db.connect();
    }
    const { nativeTokens } = await import('/game/db/sql.js');
    return nativeTokens(hintTokenConnection, sql);
  }, sql);
  let depth = 0;
  const clean = tokens.filter(token => token.type !== 5).map(token => {
    const word = token.text.match(/^[A-Za-z_][A-Za-z_0-9]*/)?.[0]?.toUpperCase() ?? token.text[0];
    if (word === ')') depth--;
    const result = { ...token, word, depth };
    if (word === '(') depth++;
    return result;
  });
  const clause = token => token.type === 4 && ['SELECT', 'FROM', 'WHERE', 'HAVING', 'QUALIFY', 'GROUP', 'ORDER', 'LIMIT', 'OFFSET', 'JOIN', 'ON', 'UNION', 'EXCEPT', 'INTERSECT'].includes(token.word);
  const removals = new Set();
  for (let i = 0; i < clean.length; i++) {
    const start = clean[i];
    if (!clause(start)) continue;
    let j = i + 1;
    while (j < clean.length && clean[j].depth >= start.depth && !(clean[j].depth === start.depth && clause(clean[j]))) j++;
    if (clean.slice(i + 1, j).some(token => token.type === 0 && token.word === '___')) {
      removals.add((sql.slice(0, start.start) + sql.slice(clean[j]?.start ?? sql.length)).trim());
    }
  }
  return [...removals];
}

export async function scanHintLeaks(h, pack, outline, candidates) {
  const parts = outline.split('___');
  if (parts.length < 2) throw new Error('Expected a blank in the outline');
  let completed = [parts[0]];
  for (const suffix of parts.slice(1)) completed = completed.flatMap(prefix => candidates.map(value => prefix + value + suffix));
  const removals = await blankClauseRemovals(h, outline);
  const variants = [...new Set(completed)].map(sql => ({ sql, kind: 'completion' }));
  variants.push(...removals.map(sql => ({ sql, kind: 'clause removal' })));
  const report = { tested: variants.length, ran: 0, completionRan: 0, removalRan: 0, removals: removals.length, errors: 0, leaks: [] };
  for (const variant of variants) {
    const run = await h.call('queryAnswer', variant.sql);
    if (run.error || run.refused) { report.errors++; continue; }
    report.ran++;
    report[variant.kind === 'completion' ? 'completionRan' : 'removalRan']++;
    const check = await h.call('check', pack.id, variant.sql);
    if (check.error || check.refused) throw new Error(`Runnable completion could not be checked: ${check.error}`);
    if (check.pass) report.leaks.push(variant);
  }
  return report;
}

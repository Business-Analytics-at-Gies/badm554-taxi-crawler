// Test-only oracle: complete authored outlines, actually run each variant, and
// submit every runnable variant to the same isolated answer grader as the UI.
import { readFile } from 'node:fs/promises';
const qi = (name) => `"${name.replaceAll('"', '""')}"`;
const quote = (value) => `'${value.replaceAll("'", "''")}'`;
// Preserve lexical spelling, not JavaScript numeric values. A signed number and
// its unsigned magnitude are both useful attack candidates (also covers prose
// ranges and date punctuation without dropping an actual minus sign).
function addTextVocabulary(candidates, text, composites = true) {
  text = String(text).replaceAll('−', '-');
  const suffix = (end) =>
    text
      .slice(end)
      .match(/^(?:::\s*[A-Za-z_][A-Za-z_0-9]*(?:\s*\(\s*\d+(?:\s*,\s*\d+)?\s*\))?)+/)?.[0] ?? '';
  for (const match of text.matchAll(
    /[+-]?(?:(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/g,
  )) {
    const number = match[0].replaceAll(',', '');
    candidates.add(number);
    candidates.add(number.replace(/^[+-]/, ''));
    const cast = suffix(match.index + match[0].length);
    if (cast) candidates.add(number + cast);
  }
  const strings =
    /(?<![\w'])(?:(?:DATE|TIME(?:STAMP)?(?:TZ)?(?:\s+WITH(?:OUT)?\s+TIME\s+ZONE)?|INTERVAL|UUID|BLOB|JSON|DECIMAL|NUMERIC|VARCHAR|INTEGER|BIGINT|DOUBLE|FLOAT)\s*)?(?:[eE])?'(?:\\[\s\S]|''|[^'\\])*'/gi;
  const spans = [];
  const literals = [
    ...text.matchAll(strings),
    ...text.matchAll(/\$([A-Za-z_][A-Za-z_0-9]*|)\$[\s\S]*?\$\1\$/g),
  ].sort((a, b) => a.index - b.index);
  for (const match of literals) {
    candidates.add(match[0]);
    const post = suffix(match.index + match[0].length);
    if (post) candidates.add(match[0] + post);
    spans.push([match.index, match.index + match[0].length]);
    const before = text.slice(0, match.index);
    const type = before.match(
      /\b(DATE|TIME(?:STAMP)?(?:TZ)?(?:\s+WITH(?:OUT)?\s+TIME\s+ZONE)?|INTERVAL|UUID|BLOB|JSON|DECIMAL|NUMERIC|VARCHAR|INTEGER|BIGINT|DOUBLE|FLOAT)\s*$/i,
    );
    if (type) candidates.add(type[0] + match[0]);
    const cast = before.match(/\b(?:TRY_)?CAST\s*\(\s*$/i);
    const tail = text
      .slice(match.index + match[0].length)
      .match(
        /^\s+AS\s+[A-Za-z_][A-Za-z_0-9]*(?:\s+(?:WITH|WITHOUT)\s+TIME\s+ZONE)?(?:\s*\(\s*\d+(?:\s*,\s*\d+)?\s*\))?\s*\)/i,
      );
    if (cast && tail) candidates.add(cast[0] + match[0] + tail[0]);
  }
  for (const match of text.matchAll(/\b(?:TRUE|FALSE|NULL)\b/gi)) {
    const post = suffix(match.index + match[0].length);
    if (post) candidates.add(match[0] + post);
  }
  if (composites) {
    for (const match of text.matchAll(/\b(?:TRY_)?CAST\s*\(/gi)) {
      if (spans.some(([a, b]) => match.index >= a && match.index < b)) continue;
      let depth = 1;
      for (let i = match.index + match[0].length; i < text.length; i++) {
        const string = spans.find(([a]) => a === i);
        if (string) {
          i = string[1] - 1;
          continue;
        }
        if (text[i] === '(') depth++;
        if (text[i] === ')' && --depth === 0) {
          candidates.add(text.slice(match.index, i + 1));
          break;
        }
      }
    }
    const stack = [];
    for (let i = 0; i < text.length; i++) {
      const string = spans.find(([a]) => a === i);
      if (string) {
        i = string[1] - 1;
        continue;
      }
      if (['[', '{'].includes(text[i])) stack.push(i);
      else if ([']', '}'].includes(text[i]) && stack.length) {
        const start = stack.pop(),
          value = text.slice(start, i + 1);
        candidates.add(value);
        const prefix = text.slice(0, start).match(/\b(?:MAP|ARRAY)\s*$/i);
        if (prefix) candidates.add(prefix[0] + value);
      }
    }
  }
}
const stringFields = (value) =>
  typeof value === 'string'
    ? [value]
    : value && typeof value === 'object'
      ? Object.values(value).flatMap(stringFields)
      : [];

export async function hintCandidates(h, pack, diagnosticsText = null) {
  const candidates = new Set(['TRUE', 'FALSE', 'NULL']);
  // Legacy check diagnostics are displayed by selected rungs too. Include their
  // numeric constants; extra numeric candidates only strengthen this oracle.
  const diagnostics =
    diagnosticsText ??
    (await readFile(new URL(`../../site${pack.check}`, import.meta.url), 'utf8'));
  for (const text of [pack.task, pack.guideTask, pack.rulesText, ...stringFields(pack.hints)])
    addTextVocabulary(candidates, text);
  addTextVocabulary(candidates, diagnostics, false);
  // Decode static JS string/template fragments so escaped quotes in legacy
  // diagnostic text expose the same SQL literals that the learner actually sees.
  // Interpolations remain text; no diagnostic code is evaluated.
  for (const match of diagnostics.matchAll(/(['"`])(?:\\[\s\S]|(?!\1)[^\\])*\1/g)) {
    const text = match[0]
      .slice(1, -1)
      .replace(
        /\\(u\{[0-9A-Fa-f]+\}|u[0-9A-Fa-f]{4}|x[0-9A-Fa-f]{2}|\r\n|\n|[\s\S])/g,
        (_, escape) => {
          if (escape.startsWith('u{'))
            return String.fromCodePoint(parseInt(escape.slice(2, -1), 16));
          if (escape[0] === 'u' || escape[0] === 'x')
            return String.fromCodePoint(parseInt(escape.slice(1), 16));
          return (
            { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', v: '\v', 0: '\0', '\n': '', '\r\n': '' }[
              escape
            ] ?? escape
          );
        },
      );
    addTextVocabulary(candidates, text);
  }
  for (const table of Object.keys(pack.given)) {
    const inspected = await h.call('inspect', table);
    if (!inspected.ok) throw new Error(inspected.error);
    for (const column of inspected.columns) {
      candidates.add(qi(column.name));
      candidates.add(`${qi(table)}.${qi(column.name)}`);
      const count = await h.call(
        'query',
        `SELECT count(DISTINCT ${qi(column.name)}) FROM ${qi(table)}`,
      );
      if (count.error) throw new Error(count.error);
      if (Number(count.rows[0][0]) > 50) continue;
      // Convert to text in DuckDB, not JavaScript: timestamps retain all precision.
      const values = await h.call(
        'query',
        `SELECT DISTINCT CAST(${qi(column.name)} AS VARCHAR) FROM ${qi(table)}`,
      );
      if (values.error || values.truncated)
        throw new Error(values.error ?? 'Truncated distinct-value inventory');
      for (const [value] of values.rows)
        candidates.add(`CAST(${value === null ? 'NULL' : quote(value)} AS ${column.type})`);
    }
  }
  return [...candidates];
}

async function blankClauseRemovals(h, sql) {
  const tokens = await h.page.evaluate(async (sql) => {
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
  const clean = tokens
    .filter((token) => token.type !== 5)
    .map((token) => {
      const word = token.text.match(/^[A-Za-z_][A-Za-z_0-9]*/)?.[0]?.toUpperCase() ?? token.text[0];
      if (word === ')') depth--;
      const result = { ...token, word, depth };
      if (word === '(') depth++;
      return result;
    });
  const clause = (token) =>
    token.type === 4 &&
    [
      'SELECT',
      'FROM',
      'WHERE',
      'HAVING',
      'QUALIFY',
      'GROUP',
      'ORDER',
      'LIMIT',
      'OFFSET',
      'JOIN',
      'ON',
      'UNION',
      'EXCEPT',
      'INTERSECT',
    ].includes(token.word);
  const removals = new Set();
  for (let i = 0; i < clean.length; i++) {
    const start = clean[i];
    if (!clause(start)) continue;
    let j = i + 1;
    while (
      j < clean.length &&
      clean[j].depth >= start.depth &&
      !(clean[j].depth === start.depth && clause(clean[j]))
    )
      j++;
    if (clean.slice(i + 1, j).some((token) => token.type === 0 && token.word === '___')) {
      removals.add((sql.slice(0, start.start) + sql.slice(clean[j]?.start ?? sql.length)).trim());
    }
  }
  return [...removals];
}

export async function scanHintLeaks(h, pack, outline, candidates) {
  const parts = outline.split('___');
  if (parts.length < 2) throw new Error('Expected a blank in the outline');
  let completed = [parts[0]];
  for (const suffix of parts.slice(1))
    completed = completed.flatMap((prefix) => candidates.map((value) => prefix + value + suffix));
  const removals = await blankClauseRemovals(h, outline);
  const variants = [...new Set(completed)].map((sql) => ({ sql, kind: 'completion' }));
  variants.push(...removals.map((sql) => ({ sql, kind: 'clause removal' })));
  const report = {
    tested: variants.length,
    ran: 0,
    completionRan: 0,
    removalRan: 0,
    removals: removals.length,
    errors: 0,
    leaks: [],
  };
  for (const variant of variants) {
    const run = await h.call('queryAnswer', variant.sql);
    if (run.error || run.refused) {
      report.errors++;
      continue;
    }
    report.ran++;
    report[variant.kind === 'completion' ? 'completionRan' : 'removalRan']++;
    const check = await h.call('check', pack.id, variant.sql);
    if (check.error || check.refused)
      throw new Error(`Runnable completion could not be checked: ${check.error}`);
    if (check.pass) report.leaks.push(variant);
  }
  return report;
}

// Small SQL text helpers: split statements, find the first keyword, guard the tutor's queries.
// Aware of plain/E-escaped strings, quoted identifiers, dollar strings and nested comments.

function skipQuoted(s, i, q, escapes = false) {
  for (let j = i + 1; j < s.length; j++) {
    if (escapes && s[j] === '\\') { j++; continue; }
    if (s[j] === q) {
      if (s[j + 1] === q) j++;
      else return j + 1;
    }
  }
  throw new Error('Unterminated quoted string or identifier.');
}

function skipLineComment(s, i) {
  for (let j = i + 2; j < s.length; j++) {
    if (s[j] === '\n' || s[j] === '\r') return j + 1;
  }
  return s.length;
}

function skipBlockComment(s, i) {
  let depth = 1;
  for (let j = i + 2; j < s.length; j++) {
    if (s[j] === '/' && s[j + 1] === '*') { depth++; j++; }
    else if (s[j] === '*' && s[j + 1] === '/') {
      j++;
      if (--depth === 0) return j + 1;
    }
  }
  throw new Error('Unterminated /* comment.');
}

// DuckDB identifiers can contain $, digits and non-ASCII characters. A quote prefix
// embedded in such an identifier must not consume the SQL that follows it.
const identifierPart = (c) => c !== undefined && /[A-Za-z0-9_$\u0080-\uFFFF]/.test(c);
const dollarQuote = /\$(?:[A-Za-z_\u0080-\uFFFF][A-Za-z0-9_\u0080-\uFFFF]*)?\$/y;
function dollarTag(s, i) {
  if (identifierPart(s[i - 1])) return null;
  dollarQuote.lastIndex = i;
  const m = dollarQuote.exec(s);
  return m ? m[0] : null;
}

// Walk the text and call visit(kind, start, end) for each piece: 'code', 'string', 'ident', 'comment'.
function scan(s, visit) {
  let i = 0;
  let code = 0;
  let continuedEscape = false, afterString = false, newline = false;
  const flush = (end) => { if (end > code) visit('code', code, end); };
  while (i < s.length) {
    const c = s[i];
    const d = s[i + 1];
    let kind = null;
    let end = i;
    if (afterString && /\s/.test(c)) { if (c === '\n' || c === '\r') newline = true; i++; continue; }
    if ((c === 'E' || c === 'e') && d === "'" && !identifierPart(s[i - 1])) {
      kind = 'string'; end = skipQuoted(s, i + 1, "'", true); continuedEscape = true;
    }
    else if (c === "'") { kind = 'string'; continuedEscape = afterString && newline && continuedEscape; end = skipQuoted(s, i, "'", continuedEscape); }
    else if (c === '"') { kind = 'ident'; end = skipQuoted(s, i, '"'); }
    else if (c === '-' && d === '-') { kind = 'comment'; end = skipLineComment(s, i); }
    else if (c === '/' && d === '*') { kind = 'comment'; end = skipBlockComment(s, i); }
    else if (c === '$') {
      const tag = dollarTag(s, i);
      if (tag) {
        const j = s.indexOf(tag, i + tag.length);
        kind = 'string';
        if (j < 0) throw new Error('Unterminated dollar-quoted string.');
        end = j + tag.length; continuedEscape = false;
      }
    }
    if (kind) {
      flush(i);
      visit(kind, i, end);
      if (kind !== 'comment') { afterString = kind === 'string'; newline = false; }
      i = code = end;
    } else {
      afterString = false; continuedEscape = false; newline = false;
      i++;
    }
  }
  flush(s.length);
}

/** Split SQL text into statements on top-level semicolons. Drops empty and comment-only pieces. */
export function splitStatements(sql) {
  const text = String(sql ?? '');
  const out = [];
  let start = 0;
  let meaningful = false;
  scan(text, (kind, a, b) => {
    if (kind === 'comment') return;
    if (kind !== 'code') { meaningful = true; return; }
    for (let i = a; i < b; i++) {
      if (text[i] === ';') {
        if (meaningful) out.push(text.slice(start, i).trim());
        start = i + 1;
        meaningful = false;
      } else if (!/\s/.test(text[i])) {
        meaningful = true;
      }
    }
  });
  if (meaningful) out.push(text.slice(start).trim());
  return out;
}

/** Keywords of a statement in order (outside strings and comments), upper-cased, first `max` only. */
export function keywords(stmt, max = 3) {
  const words = [];
  const text = String(stmt ?? '');
  scan(text, (kind, a, b) => {
    if (kind !== 'code' || words.length >= max) return;
    const re = /[A-Za-z_][A-Za-z0-9_]*/g;
    re.lastIndex = a;
    let m;
    while (words.length < max && (m = re.exec(text)) && m.index < b) words.push(m[0].toUpperCase());
  });
  return words;
}

const READ_FIRST = new Set(['SELECT', 'WITH', 'FROM', 'VALUES', 'TABLE', 'SHOW', 'DESCRIBE', 'DESC', 'SUMMARIZE', 'EXPLAIN']);

/** True when a single statement only reads (SELECT family, SHOW, DESCRIBE, SUMMARIZE, EXPLAIN of a read). */
export function isReadOnly(stmt) {
  const [k1, k2, k3] = keywords(stmt, 3);
  if (!READ_FIRST.has(k1)) return false;
  if (k1 === 'EXPLAIN') {
    const next = k2 === 'ANALYZE' ? k3 : k2;
    return READ_FIRST.has(next) && next !== 'EXPLAIN';
  }
  return true;
}

/** Statements whose effect a replay must repeat: anything that is not a plain read. */
export function changesState(stmt) {
  const k1 = keywords(stmt, 1)[0];
  return !(READ_FIRST.has(k1) && k1 !== 'WITH');
}

/**
 * Names the tutor may not reach: schema qualifiers outside its own copy, and table functions that
 * take a query as a string. Returns the first offending name, or null.
 */
export function forbiddenReference(stmt, blockedSchemas, blockedFunctions = ['query', 'query_table']) {
  const text = String(stmt ?? '');
  const schemas = new Set(blockedSchemas.map((x) => x.toLowerCase()));
  const funcs = new Set(blockedFunctions.map((x) => x.toLowerCase()));
  const tokens = [];
  scan(text, (kind, a, b) => {
    if (kind === 'comment') return;
    if (kind === 'ident') { tokens.push({ t: 'name', v: text.slice(a + 1, b - 1).replace(/""/g, '"').toLowerCase() }); return; }
    if (kind === 'string') { tokens.push({ t: 'other' }); return; }
    const re = /([A-Za-z_][A-Za-z0-9_$]*)|(\S)/g;
    re.lastIndex = a;
    let m;
    while ((m = re.exec(text)) && m.index < b) {
      tokens.push(m[1] ? { t: 'name', v: m[1].toLowerCase() } : { t: 'punct', v: m[2] });
    }
  });
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    const next = tokens[i + 1];
    if (tok.t !== 'name' || !next || next.t !== 'punct') continue;
    if (next.v === '.' && schemas.has(tok.v)) return tok.v;
    if (next.v === '(' && funcs.has(tok.v)) return tok.v;
  }
  return null;
}

/** Remove DuckDB "Did you mean" hints that point at qualified names (other schemas are hidden). */
export function cleanError(message) {
  return String(message ?? 'Unknown error')
    .replace(/^Error: /, '')
    .split('\n')
    .filter((line) => !/^Did you mean "[^"]*\.[^"]*"\??$/.test(line.trim()))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Production statement boundaries and syntax validation come from the vendored DuckDB.
 * It exposes tokenize/getTableNames, not extractStatements. getTableNames invokes the
 * native parser for the entire script before name discovery; a valid multi-statement script
 * reports Expected a single statement, which is not a syntax error.
 */
export async function nativeStatements(conn, sql) {
  const text = String(sql ?? '');
  try { await conn.getTableNames(text); }
  catch (error) {
    let detail;
    try { detail = JSON.parse(error.message); } catch { /* a non-JSON worker error */ }
    if (detail?.exception_type === 'Parser' || /unterminated/i.test(error.message)) {
      const message = detail?.exception_message || error.message;
      throw new Error(message.startsWith('Parser Error:') ? message : `Parser Error: ${message}`);
    }
    // Name discovery can also bind against dummy tables and report Binder/Catalog
    // errors for valid writes. Those belong to execution on the real connection;
    // only native Parser errors reject the complete script here.
    if (!detail?.exception_type) throw error;
  }
  const tokens = await conn.bindings.tokenize(text);
  const bytes = new TextEncoder().encode(text), decode = new TextDecoder();
  const out = []; let start = 0, meaningful = false;
  for (let i=0; i<tokens.offsets.length; i++) {
    const at = tokens.offsets[i];
    if (tokens.types[i] === 5) continue;
    if (tokens.types[i] === 3 && bytes[at] === 59) {
      if (meaningful) out.push(decode.decode(bytes.slice(start, at)).trim());
      start = at + 1; meaningful = false;
    } else meaningful = true;
  }
  if (meaningful) out.push(decode.decode(bytes.slice(start)).trim());
  return out;
}

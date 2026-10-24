// Reuse the existing shared SQL policy function, rather than a second folder.
// DuckDB folds only ASCII A-Z, including quoted names; Unicode stays distinct.
import { foldIdentifier as identifierKey, nativeTokens } from '../game/db/sql.js';
export { identifierKey };

export function identifierErrors(names) {
  const distinct = new Map();
  for (const name of names)
    if (typeof name === 'string' && /[^\x00-\x7f]/.test(name)) distinct.set(identifierKey(name), name);
  return [...distinct.values()]
    .map(name => `unmodelled scope non-ASCII identifier ${name}`);
}

// Only identifier positions are inspected. Literal payloads, prose, generated
// expression labels and structural enum values are not authored identifiers.
export function sqlIdentifierErrors(ast) {
  const names = [];
  const visit = node => {
    if (!node || typeof node !== 'object') return;
    for (const field of ['alias', 'table_name', 'schema_name', 'catalog_name',
      'function_name', 'schema', 'catalog', 'relation_name', 'window_name', 'identifier'])
      if (typeof node[field] === 'string') names.push(node[field]);
    for (const field of ['column_names', 'column_name_alias', 'aliases', 'using_columns', 'expected_names'])
      if (Array.isArray(node[field])) names.push(...node[field]);
    if (typeof node.key === 'string' && node.value?.query) names.push(node.key);
    Object.values(node).forEach(visit);
  };
  visit(ast);
  return identifierErrors(names);
}

export function contextIdentifierErrors(context = {}) {
  return identifierErrors([
    ...context.columns ?? [], ...context.tables ?? [], ...context.defined ?? [],
    ...Object.keys(context.schemas ?? {}),
    ...Object.values(context.schemas ?? {}).flat().map(column => column.name),
  ]);
}

// The native tree drops some identifiers (notably named WINDOW declarations).
// Recover native type-0 spans using byte offsets, not nativeTokens.text: its JS
// trim can erase characters which DuckDB preserves inside an identifier.
const prefixCaches = new WeakMap();
const quotedCaches = new WeakMap();
const separatorCaches = new WeakMap();
const parsedTree = async (conn, sql) => {
  const quoted = "'" + sql.replaceAll("'", "''") + "'";
  return JSON.parse((await conn.query(
    `SELECT system.main.json_serialize_sql(${quoted}) AS ast`,
  )).toArray()[0].ast);
};
const parsedIdentifiers = async (conn, sql) => {
  const ast = await parsedTree(conn, sql);
  return ast.error ? null : sqlIdentifierErrors(ast);
};
// Some native type-0 spans contain a Unicode separator followed by a keyword.
// Ask the parser which code points are separators; never keep our own Unicode
// whitespace table. Re-tokenize only for lexical inspection, leaving the SQL
// used for parsing, scope, binding and execution exactly as authored.
export async function inspectIdentifierTokens(conn, sql, tokens) {
  tokens ??= await nativeTokens(conn, sql);
  if (!/[^\x00-\x7f]/.test(sql)) return { tokens, errors: [] };
  const bytes = new TextEncoder().encode(sql), decode = new TextDecoder();
  let separators = separatorCaches.get(conn);
  if (!separators) separatorCaches.set(conn, separators = new Map());
  const parts = [decode.decode(bytes.slice(0, tokens[0]?.start ?? bytes.length))];
  let changed = false;
  for (const [index, token] of tokens.entries()) {
    const raw = decode.decode(bytes.slice(token.start, tokens[index + 1]?.start ?? bytes.length));
    if (token.type !== 0 || token.text.startsWith('"')) { parts.push(raw); continue; }
    let text = '';
    for (const character of raw) {
      if (character.codePointAt(0) > 127) {
        if (!separators.has(character)) {
          const ast = await parsedTree(conn, `SELECT a${character}b, 0`);
          const first = ast.statements?.[0]?.node?.select_list?.[0];
          separators.set(character, !ast.error && first?.class === 'COLUMN_REF' &&
            first.column_names.length === 1 && identifierKey(first.column_names[0]) === 'a' &&
            identifierKey(first.alias) === 'b');
        }
        if (separators.get(character)) { text += ' '; changed = true; continue; }
      }
      text += character;
    }
    parts.push(text);
  }
  const inspected = changed ? parts.join('') : sql;
  if (changed) tokens = await nativeTokens(conn, inspected);
  return { tokens, errors: await tokenIdentifierErrors(conn, inspected, tokens) };
}
async function tokenIdentifierErrors(conn, sql, tokens) {
  if (!/[^\x00-\x7f]/.test(sql)) return [];
  tokens ??= await nativeTokens(conn, sql);
  const bytes = new TextEncoder().encode(sql), decode = new TextDecoder(), errors = [];
  let prefixes = prefixCaches.get(conn), quoted = quotedCaches.get(conn);
  if (!prefixes) prefixCaches.set(conn, prefixes = new Map());
  if (!quoted) quotedCaches.set(conn, quoted = new Map());
  for (const [index, token] of tokens.entries()) {
    if (token.type !== 0) continue; // Strings and comments are data, not names.
    const raw = decode.decode(bytes.slice(token.start, tokens[index + 1]?.start ?? bytes.length));
    if (!/[^\x00-\x7f]/.test(raw)) continue;
    if (token.text.startsWith('"')) {
      // Native parsing dequotes/unescapes the quoted name and distinguishes any
      // following Unicode separator from characters inside the quotes.
      if (!quoted.has(raw)) quoted.set(raw, await parsedIdentifiers(conn, `SELECT ${raw}, 0`));
      const names = quoted.get(raw);
      errors.push(...names ?? []);
      continue;
    }
    let prefix = '';
    for (const character of raw) {
      prefix += character;
      if (character.codePointAt(0) <= 127) continue;
      // A prefix ending inside a block comment cannot parse; line comments
      // swallow the added delimiter and retain only earlier real names. Let
      // DuckDB distinguish those from names and Unicode word separators.
      if (!prefixes.has(prefix)) prefixes.set(prefix, await parsedIdentifiers(conn, `SELECT ${prefix}, 0`));
      errors.push(...prefixes.get(prefix) ?? []);
    }
  }
  return [...new Set(errors)];
}

// Explanatory metadata only. These functions never authorize or execute learner SQL.
// Statement boundaries/tokens and every accepted query tree come from pinned DuckDB.
import { foldIdentifier, nativeTokens } from './sql.js';

// Observed 1.5.4 Binder/Catalog forms (fixtures: tests/db/r18-column-cases.mjs and stage2-r19.test.mjs).
// Match only the diagnostic, never a word appearing in the echoed SQL or candidates.
export function needsColumnHelp(error) {
  let message = String(error ?? '').trim(), kind;
  if (message.startsWith('{')) {
    try {
      const detail = JSON.parse(message);
      kind = detail.exception_type; message = detail.exception_message;
    } catch { return false; }
  } else {
    const match = /^(Binder|Catalog) Error:\s*/.exec(message);
    if (!match) return false;
    kind = match[1]; message = message.slice(match[0].length);
  }
  if (!['Binder', 'Catalog'].includes(kind) || typeof message !== 'string') return false;
  // Keep line breaks within quoted names. The patterns span the complete native
  // diagnostic; echoed SQL and candidate lists are not classification inputs.
  const diagnostic = message.split(/\n(?:Candidate bindings:|Candidate tables:|Did you mean |LINE \d+:)/)[0];
  return [
    /^Referenced (?:update )?column .*not found/is,
    /^(?:Failed to create foreign key: referenced )?(?:Table|Values list) .*does not have a column (?:named|with name)/is,
    /^Column .*in (?:EXCLUDE|REPLACE) list not found/is,
    /^Column .*does not exist/is,
    /^Column .*was selected but was not found/is,
    /^No matching columns found that match regex/is,
    /^Column .*referenced in UNPIVOT but no matching entry was found/is,
    /^Could not find key .*in (?:struct|union)/is,
    /^Referenced table .*not found/is,
    /^table .*has \d+ columns available but \d+ columns specified/is,
    /^Star expression .*resulted in an empty set of columns/is,
    /^Sub-field .*does not exist in column/is,
    /^Cannot (?:drop|rename) field .*it does not exist/is,
    /^Table does not contain column .*referenced in check constraint/is,
    /^Table with name .*does not exist/is,
  ].some(pattern => pattern.test(diagnostic));
}

export async function errorTableNames(conn, sql) {
  const names = new Map();
  const add = parts => {
    const key = JSON.stringify(parts.map(foldIdentifier));
    const label = parts.map(part => /^[A-Za-z_][A-Za-z0-9_]*$/.test(part) ? part : `"${part.replaceAll('"', '""')}"`).join('.');
    if (!names.has(key)) names.set(key, { parts, table: label });
  };
  const visit = (node, scope = new Set()) => {
    if (!node || typeof node !== 'object') return;
    const local = new Set(scope);
    for (const entry of node.cte_map?.map ?? []) {
      visit(entry.value.query, local);
      local.add(foldIdentifier(entry.key));
    }
    if (node.type === 'BASE_TABLE') {
      if (node.schema_name || node.catalog_name || !local.has(foldIdentifier(node.table_name))) {
        add([node.catalog_name, node.schema_name, node.table_name].filter(Boolean));
      }
    }
    for (const [key, value] of Object.entries(node)) {
      if (key === 'cte_map' || !value || typeof value !== 'object') continue;
      const childScope = node.type === 'RECURSIVE_CTE_NODE' && key === 'right'
        ? new Set([...local, foldIdentifier(node.cte_name)]) : local;
      if (Array.isArray(value)) value.forEach(child => visit(child, childScope));
      else visit(value, childScope);
    }
  };
  let unsupportedRoot = false;
  const parse = async text => {
    const quoted = `'${text.replaceAll("'", "''")}'`;
    const result = await conn.query(`SELECT system.main.json_serialize_sql(${quoted}) AS parsed`);
    const ast = JSON.parse(result.toArray()[0].parsed);
    if (ast.error) {
      unsupportedRoot = ast.error_type === 'not implemented';
      return false;
    }
    if (ast.statements?.length !== 1) return false;
    visit(ast);
    return true;
  };
  sql = String(sql);
  if (await parse(sql)) return [...names.values()];
  // Only a natively valid, unsupported root can enter wrapper discovery.
  // Syntax errors must not become a valid query by dropping header tokens.
  if (!unsupportedRoot) return [];

  // Closed R5 scope: one tokenization and at most one more serialization.
  // Never try progressively smaller regions: losing a WITH scope could turn a
  // CTE into an unrelated physical table. An unrecognized wrapper gets no list.
  const tokens = (await nativeTokens(conn, sql)).filter(token => token.type !== 5);
  if (tokens.at(-1)?.text === ';') tokens.pop();
  const word = i => tokens[i]?.type === 4 ? foldIdentifier(tokens[i].text) : '';
  const bytes = new TextEncoder().encode(sql), decoder = new TextDecoder();
  const text = (start, end = tokens.length) => decoder.decode(bytes.slice(tokens[start]?.start ?? bytes.length, tokens[end]?.start ?? bytes.length));
  let i = 0;
  const take = keyword => word(i) === keyword ? (++i, true) : false;
  const identifier = () => {
    const parts = [];
    do {
      if (![0, 4].includes(tokens[i]?.type)) return null;
      const value = tokens[i++].text;
      parts.push(value.startsWith('"') ? value.slice(1, -1).replaceAll('""', '"') : value);
      if (tokens[i]?.text !== '.') break;
      // Never consume a dot without the following name component. DuckDB
      // table names have at most catalog.schema.name, each kept intact.
      if (parts.length === 3) return null;
      i++;
    } while (true);
    return parts;
  };
  const columns = () => {
    if (tokens[i]?.text !== '(') return true;
    i++;
    do {
      if (![0, 4].includes(tokens[i]?.type)) return false;
      i++;
      if (tokens[i]?.text !== ',') break;
      i++;
    } while (i < tokens.length);
    return tokens[i++]?.text === ')';
  };
  let target = null, end = tokens.length;
  if (take('create')) {
    if (take('or') && !take('replace')) return [];
    take('temp');
    if (!take('table') && !take('view')) return [];
    if (take('if') && !(take('not') && take('exists'))) return [];
    if (!identifier() || !columns() || !take('as')) return [];
    // DuckDB admits WITH [NO] DATA after a CREATE query, outside its SELECT tree.
    if (word(end - 3) === 'with' && word(end - 2) === 'no' && word(end - 1) === 'data') end -= 3;
    else if (word(end - 2) === 'with' && word(end - 1) === 'data') end -= 2;
  } else if (take('insert')) {
    if (!take('into') || !(target = identifier())) return [];
    // A parenthesized source query occupies the same position as the optional
    // target column list. If it is not a list, serialize it intact as the query.
    const start = i;
    if (!columns()) i = start;
    // RETURNING belongs to INSERT, not its source query. Only a top-level token
    // can end that query; strings, comments and nested queries cannot do so.
    let depth = 0;
    for (let j = i; j < end; j++) {
      if (tokens[j].text === '(') depth++;
      else if (tokens[j].text === ')') depth--;
      else if (!depth && word(j) === 'returning') { end = j; break; }
    }
  } else if (word(i) === 'update' || word(i) === 'delete') {
    const update = take('update');
    if (!update && !(take('delete') && take('from'))) return [];
    const start = i;
    target = identifier();
    if (!target) return [];
    const nameEnd = i;
    const boundary = () => update ? word(i) === 'set'
      : i === tokens.length || ['where', 'using', 'returning'].includes(word(i));
    if (!boundary()) {
      // The closed pattern permits one bare alias, then its clause boundary.
      // AS alias and every other extra header token are outside that pattern.
      if (![0, 4].includes(tokens[i]?.type)) return [];
      i++;
      if (!boundary()) return [];
    }
    // Preserve the native spelling when checking the name slot. Quoting every
    // token would turn a modifier such as ONLY into an unrelated physical name.
    // The SELECT parser must itself identify this as one actual table reference.
    return await parse(`SELECT * FROM ${text(start, nameEnd)}`) ? [...names.values()] : [];
  } else return [];
  if (i >= end || !await parse(text(i, end))) return [];
  if (target) add(target);
  return [...names.values()];
}

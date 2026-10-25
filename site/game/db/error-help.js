// Explanatory metadata only. These functions never authorize or execute learner SQL.
// Statement boundaries/tokens and every accepted query tree come from pinned DuckDB.
import { foldIdentifier, nativeTokens } from './sql.js';

// Observed 1.5.4 Binder/Catalog forms (fixtures: tests/db/r18-column-cases.mjs).
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
  const diagnostic = message.split(/\n(?:Candidate|Did you mean|LINE \d+:)/)[0];
  return [
    /^Referenced (?:update )?column .*not found/i,
    /^(?:Failed to create foreign key: referenced )?(?:Table|Values list) .*does not have a column (?:named|with name)/i,
    /^Column .*in (?:EXCLUDE|REPLACE) list not found/i,
    /^Column .*does not exist/i,
    /^Column .*was selected but was not found/i,
    /^No matching columns found that match regex/i,
    /^Column .*referenced in UNPIVOT but no matching entry was found/i,
    /^Could not find key .*in (?:struct|union)/i,
    /^Referenced table .*not found/i,
    /^table .*has \d+ columns available but \d+ columns specified/i,
    /^Star expression .*resulted in an empty set of columns/is,
    /^Sub-field .*does not exist in column/i,
    /^Cannot (?:drop|rename) field .*it does not exist/i,
    /^Table with name .*does not exist/i,
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
  const parse = async text => {
    const quoted = `'${text.replaceAll("'", "''")}'`;
    const result = await conn.query(`SELECT system.main.json_serialize_sql(${quoted}) AS parsed`);
    const ast = JSON.parse(result.toArray()[0].parsed);
    if (ast.error) return false;
    visit(ast);
    return true;
  };
  if (await parse(String(sql))) return [...names.values()];

  // The JSON serializer only admits SELECT-family roots. Find maximal native-
  // parsed query regions inside any wrapper, rather than an allowlist of DDL.
  // Parenthesis depth only bounds candidates; DuckDB decides whether each is SQL.
  const tokens = (await nativeTokens(conn, sql)).filter(token => token.type !== 5);
  const bytes = new TextEncoder().encode(sql), decoder = new TextDecoder();
  const text = (start, end) => decoder.decode(bytes.slice(tokens[start]?.start ?? bytes.length, tokens[end]?.start ?? bytes.length));
  const word = i => tokens[i]?.type === 4 ? foldIdentifier(tokens[i].text) : '';
  const depth = [];
  let level = 0;
  for (let i = 0; i < tokens.length; i++) {
    depth[i] = level;
    if (tokens[i].text === '(') level++;
    if (tokens[i].text === ')') level--;
  }
  depth[tokens.length] = level;
  let main = 0, prefix = '';
  if (word(0) === 'with') {
    main = tokens.findIndex((token, i) => depth[i] === 0 && tokens[i - 1]?.text === ')'
      && ['insert', 'update', 'delete', 'merge'].includes(word(i)));
    if (main < 0) main = 0;
    else prefix = text(0, main);
  }
  const covered = [];
  if (prefix && await parse(`${prefix} SELECT 1`)) covered.push([0, main]);

  const identifier = start => {
    const parts = [];
    for (let i = start; i < tokens.length; i += 2) {
      if (![0, 4].includes(tokens[i].type)) break;
      const value = tokens[i].text;
      parts.push(value.startsWith('"') ? value.slice(1, -1).replaceAll('""', '"') : value);
      if (tokens[i + 1]?.text !== '.') break;
    }
    return parts;
  };
  // Existing write targets also supply columns for target-column diagnostics.
  // CREATE destinations are excluded: they have not been created.
  const command = word(main);
  let target = -1;
  if (command === 'update' || command === 'analyze' || command === 'copy') target = main + 1;
  if (['insert', 'merge'].includes(command)) target = tokens.findIndex((_, i) => i > main && depth[i] === 0 && word(i) === 'into') + 1;
  if (command === 'delete') target = main + 2;
  if (command === 'alter' && word(main + 1) === 'table') target = main + 2;
  if (command === 'vacuum') target = main + (word(main + 1) === 'analyze' ? 2 : 1);
  if (target > 0 && tokens[target]?.text !== '(') {
    const parts = identifier(target);
    if (parts.length) add(parts);
  }
  for (let i = main; i < tokens.length; i++) if (word(i) === 'references') {
    const parts = identifier(i + 1);
    if (parts.length) add(parts);
  }

  for (let start = main; start < tokens.length; start++) {
    if (covered.some(([a, b]) => start >= a && start < b)) continue;
    const keyword = word(start);
    const rootClause = depth[start] === 0 && ['from', 'using'].includes(keyword);
    const queryStart = ['select', 'with', 'values', 'pivot', 'unpivot'].includes(keyword)
      || (['from', 'table'].includes(keyword) && ['(', 'as'].includes(foldIdentifier(tokens[start - 1]?.text ?? '')));
    if (!queryStart && !rootClause) continue;
    let limit = start + 1;
    while (limit < tokens.length && !(tokens[limit].text === ')' && depth[limit] === depth[start])) limit++;
    for (let end = limit; end > start; end--) {
      if (depth[end] !== depth[start] && end !== limit) continue;
      const fragment = keyword === 'using' ? `FROM ${text(start + 1, end)}` : text(start, end);
      if (await parse(prefix + fragment)) { covered.push([start, end]); break; }
    }
  }
  return [...names.values()];
}

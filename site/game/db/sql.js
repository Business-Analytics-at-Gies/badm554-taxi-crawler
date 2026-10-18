// All SQL decisions use the vendored DuckDB parser, tokenizer and SELECT syntax tree.
// There is deliberately no JavaScript SQL scanner or keyword-based read-only fallback.
export const foldIdentifier = name => String(name).replace(/[A-Z]/g, c => c.toLowerCase());
const literal = text => `'${String(text).replaceAll("'", "''")}'`;

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
    if (detail?.exception_type === 'Parser') {
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

/** Native tokens with UTF-8 offsets, never retokenized by JavaScript. */
export async function nativeTokens(conn, sql) {
  const text = String(sql ?? ''), bytes = new TextEncoder().encode(text), decode = new TextDecoder();
  const tokens = await conn.bindings.tokenize(text);
  return tokens.offsets.map((start, i) => ({
    type: tokens.types[i], start,
    text: decode.decode(bytes.slice(start, tokens.offsets[i+1] ?? bytes.length)).trim(),
  }));
}

/**
 * Classify a single, natively parsed statement and inspect native syntax-tree references.
 * json_serialize_sql is loaded from the pinned same-origin JSON extension. It supports SELECT-family
 * statements (including WITH, SHOW, DESCRIBE and SUMMARIZE); writes return its explicit
 * 'not implemented' result. EXPLAIN's child is located using DuckDB's own token offsets.
 * A failure to parse or inspect never authorizes execution by the tutor.
 * Call with a dedicated parser connection, so learner transactions/search paths cannot
 * interrupt classification. The serializer is fully qualified in the immutable catalog.
 */
export async function nativeReadPolicy(conn, sql, blockedSchemas = [], blockedFunctions = ['query', 'query_table', 'json_execute_serialized_sql']) {
  const statements = await nativeStatements(conn, sql);
  if (statements.length !== 1) return { readOnly: false, blockedReference: null };
  let source = statements[0];
  const tokens = (await nativeTokens(conn, source)).filter(t => t.type !== 5);
  if (tokens[0]?.type === 4 && foldIdentifier(tokens[0].text) === 'explain') {
    const child = tokens[1]?.type === 4 && foldIdentifier(tokens[1].text) === 'analyze' ? tokens[2] : tokens[1];
    if (!child) return { readOnly: false, blockedReference: null };
    source = new TextDecoder().decode(new TextEncoder().encode(source).slice(child.start));
  }
  const table = await conn.query(`SELECT system.main.json_serialize_sql(${literal(source)}) AS parsed`);
  const parsed = JSON.parse(table.toArray()[0].parsed);
  if (parsed.error) {
    if (parsed.error_type === 'not implemented') return { readOnly: false, blockedReference: null };
    throw new Error(`Parser Error: ${parsed.error_message || 'DuckDB could not inspect this SQL.'}`);
  }
  if (parsed.statements?.length !== 1 || !parsed.statements[0].node) throw new Error('DuckDB could not inspect this SQL.');
  const schemas = new Set(blockedSchemas.map(foldIdentifier));
  const functions = new Set(blockedFunctions.map(foldIdentifier));
  let blockedReference = null;
  const calledFunctions = new Set();
  const visit = node => {
    if (!node || typeof node !== 'object' || blockedReference) return;
    // These fields are native identifier nodes, not words found in SQL strings.
    for (const field of ['schema_name', 'catalog_name', 'schema', 'catalog']) {
      if (typeof node[field] === 'string' && schemas.has(foldIdentifier(node[field]))) {
        blockedReference = foldIdentifier(node[field]); return;
      }
    }
    if (typeof node.function_name === 'string') {
      const name = foldIdentifier(node.function_name);
      calledFunctions.add(name);
      if (functions.has(name)) { blockedReference = name; return; }
    }
    for (const value of Object.values(node)) if (value && typeof value === 'object') visit(value);
  };
  visit(parsed.statements[0]);
  if (!blockedReference && calledFunctions.size) {
    // SELECT alone does not prove read-only: nextval() and user macros can change
    // state or hide references. DuckDB's own function catalog supplies that decision.
    // This build does not classify table functions' side effects (NULL). Only
    // these known read-only internal table functions supplement its classification;
    // unknowns, user macros, and stateful functions such as checkpoint stay refused.
    const readTables = new Set(['range', 'generate_series', 'unnest', 'repeat',
      'duckdb_tables', 'duckdb_columns', 'duckdb_views', 'duckdb_functions',
      'duckdb_schemas', 'duckdb_sequences', 'duckdb_databases', 'duckdb_memory',
      'pragma_table_info', 'pragma_show_tables', 'pragma_show_tables_expanded',
      'pragma_database_list', 'json_each', 'json_tree']);
    const classified = await conn.query(`SELECT system.main.lower(function_name) AS name,
      internal, has_side_effects, function_type FROM system.main.duckdb_functions()
      WHERE system.main.lower(function_name) IN (${[...calledFunctions].map(literal).join(',')})`);
    const metadata = classified.toArray();
    for (const name of calledFunctions) {
      const matches = metadata.filter(row => row.name === name);
      if (!matches.length || matches.some(row => !row.internal || row.has_side_effects === true ||
        !(row.has_side_effects === false || row.function_type === 'macro' ||
          (row.function_type === 'table' && readTables.has(name))))) {
        return { readOnly: false, blockedReference: null };
      }
    }
  }
  return { readOnly: true, blockedReference };
}

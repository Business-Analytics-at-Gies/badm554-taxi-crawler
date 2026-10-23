// Native syntax and function policy are shared with the tutor and The Rerun.
// This stricter entry point admits only one SELECT and only this floor's given tables.
import { nativeStatements, nativeTokens, nativeReadPolicy, foldIdentifier } from './sql.js';
export const ANSWER_POLICY_MESSAGE = 'Your answer is one query: SELECT, or WITH ... SELECT. Use Scratch for anything else.';
const quote = text => `'${String(text).replaceAll("'", "''")}'`;
export async function answerPolicy(conn, sql, given) {
  const refused = { error: ANSWER_POLICY_MESSAGE, refused: true };
  try {
    const statements = await nativeStatements(conn, sql);
    if (statements.length !== 1) return refused;
    const tokens = (await nativeTokens(conn, statements[0])).filter(t => t.type !== 5);
    if (!['select', 'with'].includes(foldIdentifier(tokens[0]?.text ?? ''))) return refused;
    const table = await conn.query(`SELECT system.main.json_serialize_sql(${quote(statements[0])}) AS parsed`);
    const ast = JSON.parse(table.toArray()[0].parsed);
    if (ast.error || ast.statements?.length !== 1) return refused;
    let foreign = false, external = false;
    const inputs = new Set(given.map(foldIdentifier));
    const visit = (node, scope = new Set()) => {
      if (!node || typeof node !== 'object') return;
      const entries = node.cte_map?.map ?? [];
      const local = new Set([...scope, ...entries.map(entry => foldIdentifier(entry.key))]);
      if (node.type === 'BASE_TABLE') {
        const name = foldIdentifier(node.table_name);
        if (/https?:\/\//i.test(name)) external = true;
        if (node.schema_name || node.catalog_name || (!inputs.has(name) && !local.has(name))) foreign = true;
      }
      if (typeof node.function_name === 'string' && /^(duckdb_|pragma_)/i.test(node.function_name)) foreign = true;
      for (const [key, value] of Object.entries(node)) if (key !== 'cte_map' && value && typeof value === 'object') {
        if (Array.isArray(value)) value.forEach(child => visit(child, local));
        else visit(value, local);
      }
      for (const entry of entries) visit(entry.value.query, local);
    };
    visit(ast.statements[0]);
    if (external) return refused;
    if (foreign) return { error: `Use only the given tables on this floor: ${given.join(', ')}.`, refused: true };
    const policy = await nativeReadPolicy(conn, statements[0]);
    if (!policy.readOnly || policy.blockedReference) return refused;
    return { sql: statements[0] };
  } catch { return refused; }
}

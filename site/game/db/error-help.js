// Discover physical inputs for column help with DuckDB's native SELECT tree.
// This is explanatory only: it never authorizes SQL or evaluates the query.
import { foldIdentifier } from './sql.js';

export async function errorTableNames(conn, sql, schema) {
  const quoted = `'${String(sql).replaceAll("'", "''")}'`;
  const table = await conn.query(`SELECT system.main.json_serialize_sql(${quoted}) AS parsed`);
  const ast = JSON.parse(table.toArray()[0].parsed);
  if (ast.error) return [];
  const names = new Map();
  const visit = (node, scope = new Set()) => {
    if (!node || typeof node !== 'object') return;
    const local = new Set(scope);
    // A CTE body sees preceding definitions, not its own non-recursive name.
    for (const entry of node.cte_map?.map ?? []) {
      visit(entry.value.query, local);
      local.add(foldIdentifier(entry.key));
    }
    if (node.type === 'BASE_TABLE') {
      const name = foldIdentifier(node.table_name);
      const qualified = node.schema_name || node.catalog_name;
      const visible = (!node.schema_name || foldIdentifier(node.schema_name) === schema)
        && (!node.catalog_name || foldIdentifier(node.catalog_name) === 'memory');
      if (visible && (qualified || !local.has(name))) names.set(name, node.table_name);
    }
    for (const [key, value] of Object.entries(node)) {
      if (key === 'cte_map' || !value || typeof value !== 'object') continue;
      const childScope = node.type === 'RECURSIVE_CTE_NODE' && key === 'right'
        ? new Set([...local, foldIdentifier(node.cte_name)]) : local;
      if (Array.isArray(value)) value.forEach(child => visit(child, childScope));
      else visit(value, childScope);
    }
  };
  visit(ast);
  return [...names.values()];
}

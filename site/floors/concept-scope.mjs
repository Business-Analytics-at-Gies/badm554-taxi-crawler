// Names are checked on the parsed tree: binding can erase LIMIT expressions
// and turn implicit session macros into constants. Never infer scope from a plan.
// DuckDB folds ASCII identifiers only, including inside double quotes.
const fold = (name) => String(name).replace(/[A-Z]/g, (letter) => letter.toLowerCase());
const qi = (name) => `"${name.replaceAll('"', '""')}"`;
const builtinCaches = new WeakMap();
const objects = (node, visit) => {
  if (!node || typeof node !== 'object') return;
  if (!Array.isArray(node)) visit(node);
  Object.values(node).forEach((child) => objects(child, visit));
};
export async function scopePreflight(conn, ast) {
  const errors = [],
    names = new Set();
  objects(ast, (node) => {
    if (node.class === 'COLUMN_REF') names.add(node.column_names.at(-1));
    if (node.class && node.alias) names.add(node.alias);
    for (const name of node.column_name_alias ?? []) names.add(name);
    for (const entry of node.cte_map?.map ?? [])
      for (const name of entry.value.aliases) names.add(name);
    if (['LIMIT_MODIFIER', 'LIMIT_PERCENT_MODIFIER'].includes(node.type))
      for (const field of ['limit', 'offset'])
        objects(node[field], (ref) => {
          if (ref.class === 'COLUMN_REF')
            errors.push(`unresolved name ${ref.column_names.join('.')}`);
        });
  });
  let cache = builtinCaches.get(conn);
  if (!cache) builtinCaches.set(conn, (cache = new Map()));
  // This connection has no tables or views, including the givens used for plans.
  // Probe the quoted name itself, never a function list or a spelling heuristic.
  let empty;
  try {
    for (const name of names) {
      if (!cache.has(fold(name))) {
        empty ??= await conn.bindings.connect();
        try {
          await empty.query(`SELECT ${qi(name)}`);
          cache.set(fold(name), true);
        } catch (error) {
          if (
            !/^Binder Error: Referenced column .* (?:not found in FROM clause|was not found because the FROM clause is missing)/i.test(
              error.message,
            )
          )
            throw error;
          cache.set(fold(name), false);
        }
      }
      if (cache.get(fold(name))) errors.push(`built-in name ${name}: rename it`);
    }
  } finally {
    if (empty) await empty.close();
  }
  return [...new Set(errors)];
}

export async function inspectScope(ast, schemas = {}, outputNames) {
  const errors = [],
    unresolved = (names) => errors.push(`unresolved name ${names.join('.')}`);
  const unmodelled = (construct) => errors.push(`unmodelled scope ${construct}`);
  const rename = (columns, aliases = []) => {
    if (aliases.length > columns.length) errors.push('too many column names');
    return columns.map((name, i) => aliases[i] ?? name);
  };
  // DuckDB disambiguates duplicate names at a derived-table boundary. Keep
  // duplicates within SELECT so ambiguous references cannot authorize themselves.
  const unique = (columns) => {
    const used = new Set();
    return columns.map((name) => {
      let result = name,
        i = 1;
      while (used.has(fold(result))) result = `${name}_${i++}`;
      used.add(fold(result));
      return result;
    });
  };
  const count = (columns, name) => columns.filter((c) => fold(c) === fold(name)).length;
  const resolve = (names, inputs, aliases, preferAlias = false) => {
    if (names.length === 1) {
      const own = inputs.reduce((n, t) => n + count(t.columns, names[0]), 0);
      const alias = count(aliases, names[0]);
      if ((preferAlias && alias ? alias : own || alias) !== 1) unresolved(names);
    } else if (names.length === 2) {
      const matches = inputs.filter((t) => fold(t.name) === fold(names[0]));
      if (matches.length !== 1 || count(matches[0].columns, names[1]) !== 1) unresolved(names);
    } else unresolved(names);
  };
  const expression = async (node, inputs, aliases, env, preferAlias = false) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      for (const child of node) await expression(child, inputs, aliases, env, preferAlias);
      return;
    }
    if (node.class === 'COLUMN_REF') {
      resolve(node.column_names, inputs, aliases, preferAlias);
      return;
    }
    if (node.class === 'SUBQUERY') {
      // A nested query receives CTE definitions, never an outer row or alias.
      await query(node.subquery.node, env);
      await expression(node.child, inputs, aliases, env, preferAlias);
      return;
    }
    if (node.class === 'STAR') {
      if (
        node.relation_name &&
        inputs.filter((t) => fold(t.name) === fold(node.relation_name)).length !== 1
      )
        unresolved([node.relation_name, '*']);
      return;
    }
    if (
      node.class &&
      ![
        'CONSTANT',
        'FUNCTION',
        'WINDOW',
        'COMPARISON',
        'CONJUNCTION',
        'OPERATOR',
        'CAST',
        'CASE',
        'BETWEEN',
      ].includes(node.class)
    ) {
      unmodelled(node.class);
      return;
    }
    for (const [field, child] of Object.entries(node))
      if (!['value', 'cast_type'].includes(field) && child && typeof child === 'object')
        await expression(child, inputs, aliases, env, preferAlias);
  };
  const from = async (node, env) => {
    if (!node) {
      unmodelled('missing FROM');
      return [];
    }
    let columns,
      name = node.alias || node.table_name || 'unnamed_subquery';
    switch (node.type) {
      case 'EMPTY':
        return [];
      case 'BASE_TABLE': {
        const cte = !node.schema_name && !node.catalog_name && env.get(fold(node.table_name));
        columns = cte
          ? cte.columns
          : Object.entries(schemas)
              .find(([table]) => fold(table) === fold(node.table_name))?.[1]
              .map((c) => c.name);
        if (!columns) {
          unresolved([node.table_name]);
          columns = [];
        }
        break;
      }
      case 'SUBQUERY':
        columns = unique(await query(node.subquery.node, env));
        break;
      case 'EXPRESSION_LIST':
        for (const row of node.values) await expression(row, [], [], env);
        columns = node.values[0]?.map((_, i) => `col${i}`) ?? [];
        break;
      case 'JOIN': {
        const left = await from(node.left, env),
          right = await from(node.right, env);
        const inputs = [...left, ...right];
        await expression(node.condition, inputs, [], env);
        if (node.alias) unmodelled('JOIN alias');
        if (node.using_columns?.length) unmodelled('JOIN USING');
        return inputs;
      }
      default:
        unmodelled(node.type);
        return [];
    }
    return [{ name, columns: rename(columns, node.column_name_alias) }];
  };
  const modifiers = async (node, inputs, aliases, env) => {
    for (const modifier of node.modifiers ?? []) {
      if (modifier.type === 'ORDER_MODIFIER')
        for (const order of modifier.orders)
          await expression(order.expression, inputs, aliases, env, true);
      else if (['LIMIT_MODIFIER', 'LIMIT_PERCENT_MODIFIER'].includes(modifier.type)) {
        for (const field of ['limit', 'offset'])
          objects(modifier[field], (ref) => {
            if (ref.class === 'COLUMN_REF') unresolved(ref.column_names);
          });
        for (const field of ['limit', 'offset']) await expression(modifier[field], [], [], env);
      } else if (modifier.type === 'DISTINCT_MODIFIER')
        await expression(modifier.distinct_on_targets, inputs, aliases, env);
      else unmodelled(modifier.type);
    }
  };
  const query = async (node, inherited = new Map()) => {
    if (!node) {
      unmodelled('missing query');
      return [];
    }
    const env = new Map(inherited);
    for (const entry of node.cte_map?.map ?? []) {
      const columns = await query(entry.value.query.node, env);
      env.set(fold(entry.key), {
        columns: rename(unique(columns), entry.value.aliases),
        entry,
      });
    }
    if (node.type === 'SET_OPERATION_NODE') {
      const left = await query(node.left, env);
      await query(node.right, env);
      await modifiers(node, [], left, env);
      return left;
    }
    if (node.type !== 'SELECT_NODE') {
      unmodelled(node.type);
      return [];
    }
    const inputs = await from(node.from_table, env);
    const aliases = node.select_list.filter((e) => e.alias).map((e) => e.alias);
    for (const e of node.select_list) await expression(e, inputs, [], env);
    for (const clause of ['where_clause', 'group_expressions', 'having'])
      await expression(node[clause], inputs, aliases, env);
    if (node.qualify) unmodelled('QUALIFY');
    await modifiers(node, inputs, aliases, env);
    const columns = node.select_list.flatMap((e) => {
      if (e.alias) return [e.alias];
      if (e.class === 'COLUMN_REF') return [e.column_names.at(-1)];
      if (e.class === 'STAR')
        return inputs
          .filter((t) => !e.relation_name || fold(t.name) === fold(e.relation_name))
          .flatMap((t) => t.columns);
      return [null];
    });
    // The resolver establishes visibility itself. For computed select-list labels
    // only, ask the engine for its display names, without executing any rows.
    if (columns.includes(null)) {
      if (outputNames && !errors.length) {
        try {
          return await outputNames(node, env);
        } catch {
          unmodelled('output names');
        }
      }
      return columns.map((name, i) => name ?? `__unlabelled_expression_${i}`);
    }
    return columns;
  };
  for (const statement of ast.statements ?? []) await query(statement.node);
  return [...new Set(errors)];
}

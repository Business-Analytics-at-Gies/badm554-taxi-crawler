import { CONCEPT_MAP } from './concept-map.mjs';
const nullTest = (n) => ['OPERATOR_IS_NULL', 'OPERATOR_IS_NOT_NULL'].includes(n?.type);
const forObjects = (node, fn) => {
  if (!node || typeof node !== 'object') return;
  if (!Array.isArray(node)) fn(node);
  for (const child of Object.values(node)) forObjects(child, fn);
};
const fold = (name) => String(name).toLowerCase();
// Only explicit definitions add names. A bare reference cannot define itself
// (current_schema must not gain permission merely by appearing in a subquery).
export function definedNames(statement) {
  const columns = new Set(),
    inline = new Set();
  forObjects(statement, (n) => {
    if (n.class && n.alias) {
      columns.add(fold(n.alias));
      inline.add(fold(n.alias));
    }
    for (const name of n.column_name_alias ?? [])
      if (typeof name === 'string') {
        columns.add(fold(name));
        inline.add(fold(name));
      }
    for (const entry of n.cte_map?.map ?? []) {
      if (typeof entry.key === 'string') inline.add(fold(entry.key));
      for (const name of entry.value?.aliases ?? [])
        if (typeof name === 'string') {
          columns.add(fold(name));
          inline.add(fold(name));
        }
    }
    if (['BASE_TABLE', 'SUBQUERY', 'JOIN', 'EXPRESSION_LIST'].includes(n.type) && n.alias)
      inline.add(fold(n.alias));
  });
  return { columns: [...columns], inline: [...inline] };
}
// Exhaustive structural validation is independent of semantic combination rules.
// Payload strings (names/literals) have explicit scalar entries; enum strings do
// not. Every container and every list state requires an entry before recursion.
export function inspectTree(ast, map = CONCEPT_MAP, nameContext = {}) {
  const errors = [],
    concepts = new Set(),
    confirmed = new Set(),
    used = new Set(),
    objects = [],
    arrays = [];
  const fail = (path, value) =>
    errors.push(
      `unmapped construct ${path}: ${typeof value === 'string' ? value : JSON.stringify(value)}`,
    );
  const apply = (key, path, value) => {
    const e = map.entries[key];
    if (!e) {
      fail(path, value);
      return null;
    }
    used.add(key);
    for (const id of e.ids) {
      concepts.add(id);
      if (e.confidence === 'confirmed') confirmed.add(id);
    }
    return e;
  };
  const ownerOf = (n) => (n.class ? (n.class === 'SUBQUERY' ? 'SUBQUERY_EXPR' : n.class) : n.type);
  const walk = (value, expected, path) => {
    if (expected === 'string' || expected === 'number') {
      if (typeof value !== expected) fail(path, value);
      return;
    }
    if (expected === 'row_values' || expected === 'group_set') {
      if (!Array.isArray(value)) {
        fail(path, value);
        return;
      }
      // These two nested-array shapes are themselves explicit map entries.
      const key = `array:${expected}:${value.length ? 'nonempty' : 'empty'}`;
      if (!apply(key, path, value)) return;
      arrays.push({ path, kind: expected });
      value.forEach((v, i) =>
        walk(v, expected === 'group_set' ? 'number' : 'auto', `${path}[${i}]`),
      );
      return;
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      fail(path, value);
      return;
    }
    const owner = expected === 'auto' ? ownerOf(value) : expected;
    if (!owner || !apply(`object:${owner}`, path, owner)) return;
    objects.push({ path, owner });
    for (const [field, v] of Object.entries(value)) {
      const p = `${path}.${field}`,
        prefix = `${owner}.${field}:`;
      let selector = Array.isArray(v)
        ? field === 'group_sets' && owner === 'SELECT_NODE' && v.length === 1
          ? 'one'
          : v.length
            ? 'nonempty'
            : 'empty'
        : v && typeof v === 'object'
          ? 'object'
          : JSON.stringify(v);
      if (owner === 'FUNCTION' && field === 'distinct' && v === true)
        selector += ':' + value.function_name?.toLowerCase();
      let key = prefix + selector;
      if (
        !map.entries[key] &&
        v !== null &&
        ['string', 'number', 'boolean'].includes(typeof v) &&
        map.entries[prefix + '$' + typeof v]
      )
        key = prefix + '$' + typeof v;
      const entry = apply(key, p, v);
      if (!entry) continue;
      if (Array.isArray(v)) {
        arrays.push({ path: p, kind: entry.child });
        v.forEach((child, i) => walk(child, entry.child, `${p}[${i}]`));
      } else if (v && typeof v === 'object') walk(v, entry.child, p);
    }
    if (['FUNCTION', 'WINDOW'].includes(value.class))
      apply(
        `function:${value.function_name?.toLowerCase()}/${value.children?.length}`,
        `${path}.function`,
        `${value.function_name}/${value.children?.length}`,
      );
  };
  walk(ast, 'root', '$');
  const inlineDefined = new Set();
  for (const statement of ast.statements ?? [])
    definedNames(statement).inline.forEach((name) => inlineDefined.add(name));
  const rule = (name, path) => apply(`rule:${name}`, path, name);
  const bindings = (node, env) => {
    const next = new Map(env);
    for (const e of node.cte_map?.map ?? [])
      if (typeof e.key === 'string' && e.value?.query?.node)
        next.set(e.key.toLowerCase(), e.value.query.node);
    return next;
  };
  const inputJoins = (node, env, seen = new Set()) => {
    if (!node || typeof node !== 'object' || seen.has(node)) return { join: false, left: false };
    seen.add(node);
    env = bindings(node, env);
    if (node.type === 'BASE_TABLE' && !node.schema_name && env.has(node.table_name?.toLowerCase()))
      return inputJoins(env.get(node.table_name.toLowerCase()), env, seen);
    const result = {
      join: node.type === 'JOIN',
      left: node.type === 'JOIN' && node.join_type === 'LEFT',
    };
    for (const key of ['node', 'from_table', 'subquery', 'left', 'right']) {
      const r = inputJoins(node[key], env, seen);
      result.join ||= r.join;
      result.left ||= r.left;
    }
    return result;
  };
  const visit = (node, inCTE = false, scope = null, frame = false, env = new Map(), path = '$') => {
    if (!node || typeof node !== 'object') return;
    // Semantic reporting also walks rejected optional fields. A rejected field
    // still fails structurally; a nested known concept must not disappear from
    // the report just because its containing form is unsupported.
    if (node.class) {
      const owner = node.class === 'SUBQUERY' ? 'SUBQUERY_EXPR' : node.class;
      const key = `${owner}.type:${JSON.stringify(node.type)}`;
      if (map.entries[key]) apply(key, path, node.type);
    }
    if (['FUNCTION', 'WINDOW'].includes(node.class))
      apply(
        `function:${node.function_name?.toLowerCase()}/${node.children?.length}`,
        path,
        node.function_name,
      );
    env = bindings(node, env);
    for (const e of node.cte_map?.map ?? [])
      visit(e.value?.query, true, null, false, env, path + '.cte');
    const select = node.type === 'SELECT_NODE';
    if (select) {
      scope = {
        ...inputJoins(node.from_table, env),
        group: !!node.group_expressions?.length,
        nulls: [],
      };
      frame = false;
      rule('select', path);
      if (node.from_table?.type !== 'EMPTY') rule('from', path);
    }
    if (node.type === 'JOIN' && (node.condition || node.using_columns?.length))
      rule('join_key', path);
    if (nullTest(node)) {
      rule('null_test', path);
      rule('null_after_join', path);
      if (scope) scope.nulls.push(node);
    }
    if (
      node.class === 'CAST' &&
      !frame &&
      ['DATE', 'TIME', 'TIMESTAMP', 'INTERVAL'].includes(node.cast_type?.id)
    )
      rule('date', path);
    if (node.class === 'WINDOW') {
      rule('window', path);
      if (inCTE) rule('window_cte', path);
      if (node.function_name?.toLowerCase() === 'sum' && node.orders?.length) {
        rule('running_sum', path);
        if (
          node.start === 'UNBOUNDED_PRECEDING' &&
          ['CURRENT_ROW_RANGE', 'CURRENT_ROW_ROWS', 'CURRENT_ROW_GROUPS'].includes(node.end)
        )
          rule('running_sum_proof', path);
      }
    }
    if (node.function_name?.toLowerCase() === 'count_star' && scope?.group)
      rule('group_count', path);
    for (const [key, child] of Object.entries(node)) {
      if (key === 'cte_map' || !child || typeof child !== 'object') continue;
      const childFrame =
        (node.class === 'WINDOW' && ['start_expr', 'end_expr'].includes(key)) || frame;
      const nextFrame = ['COMPARISON', 'BETWEEN'].includes(node.class) ? false : childFrame;
      if (Array.isArray(child))
        child.forEach((v, i) => visit(v, inCTE, scope, nextFrame, env, `${path}.${key}[${i}]`));
      else visit(child, inCTE, scope, nextFrame, env, `${path}.${key}`);
    }
    if (select) {
      if (scope.group && scope.join) rule('join_group', path);
      if (scope.left && scope.nulls.length) {
        rule('null_after_join', path);
        rule('orphan', path);
      }
      // Prove only the standard anti-join: the null-tested right key is equated to
      // a left key. ON true and left-input NULLs can require C083, never teach it.
      const joins = [];
      forObjects(node.from_table, (n) => {
        if (n.type === 'JOIN' && n.join_type === 'LEFT') joins.push(n);
      });
      for (const j of joins) {
        const right = j.right?.alias || j.right?.table_name;
        const equalKeys = [];
        forObjects(j.condition, (n) => {
          if (
            n.type === 'COMPARE_EQUAL' &&
            n.left?.class === 'COLUMN_REF' &&
            n.right?.class === 'COLUMN_REF'
          )
            equalKeys.push(n.left.column_names, n.right.column_names);
        });
        if (
          scope.nulls.some(
            (n) =>
              n.type === 'OPERATOR_IS_NULL' &&
              n.children?.[0]?.column_names?.length === 2 &&
              n.children[0].column_names[0] === right &&
              equalKeys.some(
                (k) => JSON.stringify(k) === JSON.stringify(n.children[0].column_names),
              ),
          )
        ) {
          rule('orphan_proof', path);
          rule('unmatched_null', path);
        }
      }
    }
  };
  visit(ast);
  return {
    errors,
    concepts: [...concepts].sort(),
    confirmed: [...confirmed].sort(),
    used: [...used],
    objects,
    arrays,
    definedNames: [...inlineDefined],
  };
}
// A pure syntactic constant predicate establishes foldability; the engine, not
// spelling or JavaScript arithmetic, determines the value. Never evaluate names,
// subqueries or arbitrary functions while inspecting authored content.
export async function detectComputedZeros(conn, ast, result, map = CONCEPT_MAP) {
  const numeric = new Set([
    'TINYINT',
    'SMALLINT',
    'INTEGER',
    'BIGINT',
    'HUGEINT',
    'FLOAT',
    'DOUBLE',
    'DECIMAL',
  ]);
  const literal = (n) =>
    (n?.class === 'CONSTANT' && numeric.has(n.value?.type?.id)) ||
    (n?.class === 'CAST' && numeric.has(n.cast_type?.id) && n.child?.class === 'CONSTANT') ||
    (n?.class === 'FUNCTION' &&
      ['+', '-', '*', '/'].includes(n.function_name) &&
      n.children.every(literal));
  const comparisons = [];
  forObjects(ast, (n) => {
    if (n.class === 'COMPARISON') comparisons.push(n);
  });
  for (const n of comparisons)
    for (const operand of [n.left, n.right]) {
      if (!literal(operand)) continue;
      const select = {
        error: false,
        statements: [
          {
            node: {
              type: 'SELECT_NODE',
              modifiers: [],
              cte_map: { map: [] },
              select_list: [operand],
              from_table: {
                type: 'EMPTY',
                alias: '',
                sample: null,
                query_location: 0,
              },
              where_clause: null,
              group_expressions: [],
              group_sets: [],
              aggregate_handling: 'STANDARD_HANDLING',
              having: null,
              sample: null,
              qualify: null,
            },
            named_param_map: [],
          },
        ],
      };
      forObjects(select, (n) => {
        if ('query_location' in n) n.query_location = 0;
      });
      const data = JSON.stringify(select).replaceAll("'", "''");
      try {
        // json_deserialize_sql restores the exact parsed expression including casts.
        const sql = (
          await conn.query(`SELECT system.main.json_deserialize_sql('${data}') AS sql`)
        ).toArray()[0].sql;
        const value = (
          await conn.query(
            `SELECT CAST(c AS DOUBLE) AS v FROM (${sql.replace(/;\s*$/, '')}) folded(c)`,
          )
        ).toArray()[0];
        const v = value.v;
        if (v !== null && ['number', 'bigint'].includes(typeof v) && Number(v) === 0) {
          const e = map.entries['rule:zero'];
          if (!e) result.errors.push('unmapped construct $.comparison: zero');
          else {
            result.used.push('rule:zero');
            for (const id of e.ids) {
              result.concepts.push(id);
              if (e.confidence === 'confirmed') result.confirmed.push(id);
            }
          }
        }
      } catch (e) {
        result.errors.push(`Constant inspection failed: ${e.message}`);
      }
    }
  result.concepts = [...new Set(result.concepts)].sort();
  result.confirmed = [...new Set(result.confirmed)].sort();
  return result;
}

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
  const apply = (key, path, value, proven = true) => {
    const e = map.entries[key];
    if (!e) {
      fail(path, value);
      return null;
    }
    used.add(key);
    for (const id of e.ids) {
      concepts.add(id);
      if (proven && e.confidence === 'confirmed') confirmed.add(id);
    }
    return e;
  };
  const ownerOf = (n) =>
    n.class ? (n.class === 'SUBQUERY' ? 'SUBQUERY_EXPR' : n.class) : n.type;
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
  const rule = (name, path, proven = true) => apply(`rule:${name}`, path, name, proven);
  const bindings = (node, env) => {
    const next = new Map(env);
    for (const e of node.cte_map?.map ?? [])
      if (typeof e.key === 'string' && e.value?.query?.node)
        next.set(e.key.toLowerCase(), e.value.query.node);
    return next;
  };
  const inputJoins = (node, env, seen = new Set()) => {
    if (!node || typeof node !== 'object' || seen.has(node))
      return { join: false, left: false };
    seen.add(node);
    env = bindings(node, env);
    if (
      node.type === 'BASE_TABLE' &&
      !node.schema_name &&
      env.has(node.table_name?.toLowerCase())
    )
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
  const visit = (
    node,
    inCTE = false,
    scope = null,
    frame = false,
    env = new Map(),
    path = '$',
  ) => {
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
      if (scope.group && scope.join) rule('join_group', path, false);
      if (scope.left && scope.nulls.length) {
        rule('null_after_join', path);
        rule('orphan', path);
      }
      // Confirmed input-sensitive proofs are added only after the scope check
      // resolves actual relation/column identities on the first binding fill.
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
// Only deterministic scalar syntax is evaluated. Names, queries, aggregates,
// windows and arbitrary functions never enter the constant evaluator.
const constantCaches = new WeakMap();
export async function detectComputedZeros(conn, ast, result, map = CONCEPT_MAP) {
  const scalarFunctions = new Set(['+', '-', '*', '/', 'round', 'date_part']);
  const castTypes = new Set([
    'NULL',
    'BOOLEAN',
    'INTEGER',
    'BIGINT',
    'HUGEINT',
    'DOUBLE',
    'FLOAT',
    'DECIMAL',
    'VARCHAR',
    'DATE',
    'TIME',
    'TIMESTAMP',
    'INTERVAL',
  ]);
  const constantOnly = (node) => {
    if (!node) return false;
    switch (node.class) {
      case 'CONSTANT':
        return true;
      case 'CAST':
        return castTypes.has(node.cast_type?.id) && constantOnly(node.child);
      case 'FUNCTION':
        return (
          scalarFunctions.has(node.function_name) &&
          !!map.entries[`function:${node.function_name}/${node.children.length}`] &&
          node.children.every(constantOnly)
        );
      case 'OPERATOR':
        return (
          [
            'OPERATOR_NOT',
            'OPERATOR_COALESCE',
            'COMPARE_IN',
            'COMPARE_NOT_IN',
            'OPERATOR_IS_NULL',
            'OPERATOR_IS_NOT_NULL',
          ].includes(node.type) && node.children.every(constantOnly)
        );
      case 'CONJUNCTION':
        return node.children.every(constantOnly);
      case 'COMPARISON':
        return constantOnly(node.left) && constantOnly(node.right);
      case 'BETWEEN':
        return [node.input, node.lower, node.upper].every(constantOnly);
      case 'CASE':
        return (
          node.case_checks.every(
            (c) => constantOnly(c.when_expr) && constantOnly(c.then_expr),
          ) && constantOnly(node.else_expr)
        );
      default:
        return false;
    }
  };
  let cache = constantCaches.get(conn);
  if (!cache) constantCaches.set(conn, (cache = new Map()));
  const values = new Map(),
    comparisons = [];
  const constants = [];
  forObjects(ast, (node) => {
    if (node.class === 'COMPARISON') comparisons.push(node);
    if (constantOnly(node)) constants.push(node);
  });
  for (const operand of constants) {
    const select = {
      error: false,
      statements: [
        {
          node: {
            type: 'SELECT_NODE',
            modifiers: [],
            cte_map: { map: [] },
            select_list: [structuredClone(operand)],
            from_table: { type: 'EMPTY', alias: '', sample: null, query_location: 0 },
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
    forObjects(select, (node) => {
      if ('query_location' in node) node.query_location = 0;
    });
    const key = JSON.stringify(select);
    if (!cache.has(key)) {
      const literal = (sql) => "'" + sql.replaceAll("'", "''") + "'";
      try {
        const sql = (
          await conn.query(`SELECT system.main.json_deserialize_sql(${literal(key)}) AS sql`)
        )
          .toArray()[0]
          .sql.replace(/;\s*$/, '');
        const type = (
          await conn.query(
            `SELECT typeof(c) AS t, c AS evaluated_value FROM (${sql}) folded(c)`,
          )
        ).toArray()[0].t;
        const numeric =
          /^(?:U?(?:TINYINT|SMALLINT|INTEGER|BIGINT|HUGEINT)|FLOAT|DOUBLE|DECIMAL(?:\(.*\))?)$/.test(
            type,
          );
        // Compare inside DuckDB, retaining decimal/integer precision and NULL.
        const zero =
          numeric &&
          (await conn.query(`SELECT c = 0 AS z FROM (${sql}) folded(c)`)).toArray()[0].z ===
            true;
        cache.set(key, { zero });
      } catch (error) {
        cache.set(key, { error: error.message });
      }
    }
    const value = cache.get(key);
    values.set(operand, value);
    if (value.error) result.errors.push(`Constant inspection failed: ${value.error}`);
  }
  for (const node of comparisons)
    for (const operand of [node.left, node.right])
      if (values.get(operand)?.zero) addProof(result, map, 'zero', '$.comparison');
  result.errors = [...new Set(result.errors)];
  result.concepts = [...new Set(result.concepts)].sort();
  result.confirmed = [...new Set(result.confirmed)].sort();
  result.used = [...new Set(result.used)];
  return result;
}
function addProof(result, map, name, path) {
  const key = `rule:${name}`,
    entry = map.entries[key];
  if (!entry) result.errors.push(`unmapped construct ${path}: ${name}`);
  else {
    result.used.push(key);
    result.concepts.push(...entry.ids);
    if (entry.confidence === 'confirmed') result.confirmed.push(...entry.ids);
  }
}
// Relation objects and column positions come from inspectScope, not spellings.
// A conjunctive equality must join opposite inputs, and the tested right key
// must be that same column. OR, NOT and nested queries cannot establish a key.
export function detectScopeProofs(facts, result, map = CONCEPT_MAP) {
  // Binding fills provide columns, not new teaching claims. Confirm only
  // concepts already detected in the authored (unfilled) tree.
  const detected = new Set(result.concepts);
  const prove = (name) => {
    const entry = map.entries[`rule:${name}`] ?? CONCEPT_MAP.entries[`rule:${name}`];
    if (entry.ids.every((id) => detected.has(id))) addProof(result, map, name, '$.scope');
  };
  const same = (a, b) => a && b && a.input === b.input && a.index === b.index;
  const equalities = (node) =>
    node?.type === 'COMPARE_EQUAL'
      ? [node]
      : node?.type === 'CONJUNCTION_AND'
        ? node.children.flatMap(equalities)
        : [];
  for (const query of facts.queries) {
    if (query.node.group_expressions.length && query.hasJoin) prove('join_group');
    for (const join of query.joins) {
      if (join.node.join_type !== 'LEFT') continue;
      for (const eq of equalities(join.node.condition)) {
        const a = facts.references.get(eq.left),
          b = facts.references.get(eq.right);
        const right =
          join.left.includes(a?.input) && join.right.includes(b?.input)
            ? b
            : join.left.includes(b?.input) && join.right.includes(a?.input)
              ? a
              : null;
        if (
          right &&
          query.nulls.some(
            (n) =>
              n.type === 'OPERATOR_IS_NULL' && same(facts.references.get(n.children[0]), right),
          )
        ) {
          prove('orphan_proof');
          prove('unmatched_null');
        }
      }
    }
  }
  result.concepts = [...new Set(result.concepts)].sort();
  result.confirmed = [...new Set(result.confirmed)].sort();
  result.used = [...new Set(result.used)];
  return result;
}

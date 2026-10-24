import { CONCEPT_MAP } from './concept-map.mjs';
const nullTest = (n) => ['OPERATOR_IS_NULL', 'OPERATOR_IS_NOT_NULL'].includes(n?.type);
const temporal = (n) => ['DATE', 'TIME', 'TIMESTAMP', 'INTERVAL'].includes(n?.cast_type?.id ?? n?.value?.type?.id);
const hasNull = (node) => {
  let found = false;
  forObjects(node, n => { if (n.class === 'CONSTANT' && n.value?.is_null) found = true; });
  return found;
};
const nullRelated = (n) => nullTest(n) ||
  ['COMPARE_DISTINCT_FROM', 'COMPARE_NOT_DISTINCT_FROM', 'OPERATOR_COALESCE'].includes(n.type) ||
  (['COMPARISON', 'BETWEEN'].includes(n.class) || ['COMPARE_IN', 'COMPARE_NOT_IN'].includes(n.type)) && hasNull(n) ||
  ['coalesce', 'ifnull', 'nullif'].includes(n.function_name?.toLowerCase());
const conjuncts = (n) => n?.type === 'CONJUNCTION_AND' ? n.children.flatMap(conjuncts) : n ? [n] : [];
// A proof is a direct projection or a WHERE conjunct, never a descendant of
// NOT, OR, CASE, another predicate, or a nested query.
const predicateRoots = (query) => [...query.select_list, ...conjuncts(query.where_clause)];
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
  // Ingredients are collected afresh per statement. No scope, traversal order,
  // join lineage, negation or disjunction can hide a possible requirement.
  for (const statement of ast.statements ?? []) {
    const ingredients = { join: false, outer: false, grouping: false, nulls: false, countStar: false,
      aggregateWindow: false, orderedWindow: false, window: false, cte: false };
    const visit = (node, frame = false, path = '$') => {
      if (!node || typeof node !== 'object') return;
      if (node.class) {
        const owner = node.class === 'SUBQUERY' ? 'SUBQUERY_EXPR' : node.class;
        const key = `${owner}.type:${JSON.stringify(node.type)}`;
        if (map.entries[key]) apply(key, path, node.type);
      }
      // Also report functions beneath rejected optional fields. Rejection must
      // never hide a known requirement elsewhere in that authored subtree.
      if (['FUNCTION', 'WINDOW'].includes(node.class))
        apply(`function:${node.function_name?.toLowerCase()}/${node.children?.length}`,
          path, node.function_name);
      if (node.type === 'SELECT_NODE') {
        rule('select', path);
        if (node.from_table?.type !== 'EMPTY') rule('from', path);
        ingredients.grouping ||= !!node.group_expressions?.length || !!node.having ||
          !!node.group_sets?.length || node.aggregate_handling === 'FORCE_AGGREGATES';
      }
      ingredients.cte ||= !!node.cte_map?.map?.length;
      ingredients.countStar ||= node.function_name?.toLowerCase() === 'count_star';
      if (node.type === 'JOIN') {
        ingredients.join = true;
        ingredients.outer ||= ['LEFT', 'RIGHT', 'OUTER', 'FULL'].includes(node.join_type);
        rule('join_key', path);
      }
      if (nullRelated(node)) {
        ingredients.nulls = true;
        rule('null_test', path);
      }
      if (temporal(node)) rule('date', path);
      if (node.class === 'BETWEEN' && !frame) rule('between', path);
      if (node.class === 'WINDOW') {
        ingredients.window = true;
        ingredients.aggregateWindow ||= node.type === 'WINDOW_AGGREGATE';
        ingredients.orderedWindow ||= !!node.orders?.length || !!node.window_name;
        rule('window', path);
      }
      for (const [key, child] of Object.entries(node)) {
        if (!child || typeof child !== 'object') continue;
        const childFrame = frame || node.class === 'WINDOW' && ['start_expr', 'end_expr'].includes(key);
        if (Array.isArray(child)) child.forEach((v, i) => visit(v, childFrame, `${path}.${key}[${i}]`));
        else visit(child, childFrame, `${path}.${key}`);
      }
    };
    visit(statement);
    if (ingredients.outer) rule('null_after_join', '$');
    if (ingredients.outer && ingredients.nulls) rule('orphan', '$');
    if (ingredients.join && ingredients.grouping) rule('join_group_possible', '$');
    if (ingredients.countStar && ingredients.grouping) rule('group_count_possible', '$');
    if (ingredients.aggregateWindow && ingredients.orderedWindow) rule('running_sum', '$');
    if (ingredients.window && ingredients.cte) rule('window_cte_possible', '$');
  }
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
export async function detectComputedZeros(conn, ast, result, map = CONCEPT_MAP, negatedStatements = new Set()) {
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
    if (node.class === 'COMPARISON' || node.class === 'BETWEEN' || ['COMPARE_IN', 'COMPARE_NOT_IN'].includes(node.type)) comparisons.push(node);
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
  const zeroPredicates = new Set();
  for (const node of comparisons) {
    const operands = node.class === 'COMPARISON' ? [node.left, node.right] :
      node.class === 'BETWEEN' ? [node.input, node.lower, node.upper] : node.children;
    if (operands.some(operand => values.get(operand)?.zero)) {
      addProof(result, map, 'zero_possible', '$.predicate');
      if (node.class === 'COMPARISON' && !['COMPARE_DISTINCT_FROM', 'COMPARE_NOT_DISTINCT_FROM'].includes(node.type)) zeroPredicates.add(node);
    }
  }
  // One exact C085 proof: a direct ordinary comparison with an evaluated
  // numeric-zero operand. Scope success is required before credit.
  for (const [index, statement] of (ast.statements ?? []).entries()) {
    if (negatedStatements.has(index)) continue;
    forObjects(statement, query => {
    if (query.type !== 'SELECT_NODE') return;
    for (const predicate of predicateRoots(query))
      if (zeroPredicates.has(predicate))
        addProof(result, map, 'zero', '$.predicate');
    });
  }
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
export function detectScopeProofs(facts, result, map = CONCEPT_MAP, negatedStatements = new Set()) {
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
    if (negatedStatements.has(query.statementIndex)) continue;
    if (query.node.group_expressions.length && query.node.from_table.type === 'JOIN' &&
        query.joins.some(join => join.node === query.node.from_table && equalities(join.node.condition).some(eq => {
          const a = facts.references.get(eq.left), b = facts.references.get(eq.right);
          return join.left.includes(a?.input) && join.right.includes(b?.input) ||
            join.left.includes(b?.input) && join.right.includes(a?.input);
        }))) prove('join_group');
    for (const expression of query.node.select_list) {
      if (query.node.group_expressions.length && expression.class === 'FUNCTION' &&
          expression.function_name?.toLowerCase() === 'count_star') prove('group_count');
      if (expression.class === 'WINDOW' && expression.function_name?.toLowerCase() === 'sum' &&
          expression.orders?.length && expression.start === 'UNBOUNDED_PRECEDING' &&
          ['CURRENT_ROW_RANGE', 'CURRENT_ROW_ROWS', 'CURRENT_ROW_GROUPS'].includes(expression.end))
        prove('running_sum_proof');
      if (query.inCTE && expression.class === 'WINDOW') prove('window_cte');
    }
    for (const join of query.joins) {
      if (join.node !== query.node.from_table || join.node.join_type !== 'LEFT') continue;
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
          conjuncts(query.node.where_clause).some(
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

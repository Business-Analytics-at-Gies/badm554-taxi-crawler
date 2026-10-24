import { identifierKey as fold, sqlIdentifierErrors, contextIdentifierErrors } from './concept-identifiers.mjs';
import { CONCEPT_MAP } from './concept-map.mjs';
const nullTest = (n) => ['OPERATOR_IS_NULL', 'OPERATOR_IS_NOT_NULL'].includes(n?.type);
const temporal = (n) => ['DATE', 'TIME', 'TIMESTAMP', 'INTERVAL'].includes(n?.cast_type?.id ?? n?.value?.type?.id);
const nullRelated = (n) => nullTest(n) ||
  ['COMPARE_DISTINCT_FROM', 'COMPARE_NOT_DISTINCT_FROM', 'OPERATOR_COALESCE'].includes(n.type) ||
  ['coalesce', 'ifnull', 'nullif'].includes(fold(n.function_name));
// Roles establish predicate context. Once inside, visit every object/operand,
// including the left child and the query body of IN/ANY/ALL. Expression classes
// also identify projected predicates; operator spellings never limit operands.
function predicateObjects(root) {
  const found = new Set();
  const visit = (node, predicate = false) => {
    if (!node || typeof node !== 'object') return;
    predicate ||= node.class === 'COMPARISON' || node.class === 'BETWEEN' ||
      node.class === 'CONJUNCTION' || node.class === 'OPERATOR' && node.type !== 'OPERATOR_COALESCE' ||
      node.class === 'SUBQUERY' && node.subquery_type !== 'SCALAR';
    if (predicate && !Array.isArray(node)) found.add(node);
    for (const [field, child] of Object.entries(node)) {
      const role = ['where_clause', 'having', 'when_expr'].includes(field) ||
        node.type === 'JOIN' && field === 'condition' ||
        node.class === 'FUNCTION' && field === 'filter' ||
        node.class === 'WINDOW' && field === 'filter_expr';
      visit(child, predicate || role);
    }
  };
  visit(root);
  return found;
}
const conjuncts = (n) => n?.type === 'CONJUNCTION_AND' ? n.children.flatMap(conjuncts) : n ? [n] : [];
// A proof is a direct projection or a WHERE conjunct, never a descendant of
// NOT, OR, CASE, another predicate, or a nested query.
const predicateRoots = (query) => [...query.select_list, ...conjuncts(query.where_clause)];
// Exact combination proofs use a plain SELECT with no result-changing wrapper.
// Local WHERE proofs must be the entire predicate, not one conjunct among others.
const plainQuery = (query, where = null, grouped = false) =>
  query.where_clause === where && !query.having && !query.qualify && !query.sample &&
  !query.modifiers.length && query.aggregate_handling === 'STANDARD_HANDLING' &&
  (grouped || !query.group_expressions.length && !query.group_sets.length);
const plainColumn = node => node?.class === 'COLUMN_REF';
const plainProjection = node => plainColumn(node) || node?.class === 'STAR';
const plainValue = node => plainColumn(node) || node?.class === 'CONSTANT';
const plainAggregate = node => node?.class === 'FUNCTION' &&
  !node.distinct && !node.filter && !node.order_bys?.orders?.length &&
  (fold(node.function_name) === 'count_star' && !node.children.length ||
    ['count', 'sum', 'avg', 'min', 'max'].includes(fold(node.function_name)) &&
    node.children.length === 1 && plainValue(node.children[0]));
const plainWindow = node => node?.class === 'WINDOW' &&
  !node.distinct && !node.filter_expr && !node.ignore_nulls &&
  !node.arg_orders?.length && node.exclude_clause === 'NO_OTHER' &&
  !node.offset_expr && !node.default_expr &&
  node.children.every(plainValue) && node.partitions.every(plainColumn) &&
  node.orders.every(order => plainValue(order.expression));
const forObjects = (node, fn) => {
  if (!node || typeof node !== 'object') return;
  if (!Array.isArray(node)) fn(node);
  for (const child of Object.values(node)) forObjects(child, fn);
};
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
  const errors = [...sqlIdentifierErrors(ast), ...contextIdentifierErrors(nameContext)],
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
          : JSON.stringify(typeof v === 'string' &&
            ['schema_name', 'catalog_name', 'schema', 'catalog'].includes(field) ? fold(v) : v);
      if (owner === 'FUNCTION' && field === 'distinct' && v === true)
        selector += ':' + fold(value.function_name);
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
        `function:${fold(value.function_name)}/${value.children?.length}`,
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
    const predicates = predicateObjects(statement);
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
        apply(`function:${fold(node.function_name)}/${node.children?.length}`,
          path, node.function_name);
      if (node.type === 'SELECT_NODE') {
        rule('select', path);
        if (node.from_table?.type !== 'EMPTY') rule('from', path);
        ingredients.grouping ||= !!node.group_expressions?.length || !!node.having ||
          !!node.group_sets?.length || node.aggregate_handling === 'FORCE_AGGREGATES';
      }
      ingredients.cte ||= !!node.cte_map?.map?.length;
      ingredients.countStar ||= fold(node.function_name) === 'count_star';
      if (node.type === 'JOIN') {
        ingredients.join = true;
        ingredients.outer ||= ['LEFT', 'RIGHT', 'OUTER', 'FULL'].includes(node.join_type);
        rule('join_key', path);
      }
      if (nullRelated(node) || predicates.has(node) && node.class === 'CONSTANT' && node.value?.is_null) {
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
          scalarFunctions.has(fold(node.function_name)) &&
          !!map.entries[`function:${fold(node.function_name)}/${node.children.length}`] &&
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
    predicates = predicateObjects(ast),
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
  // A zero anywhere in any predicate requires C085. The direct-operand check
  // below is solely the exact teaching proof, not the ingredient detector.
  if ([...predicates].some(node => values.get(node)?.zero))
    addProof(result, map, 'zero_possible', '$.predicate');
  const zeroPredicates = new Set();
  for (const node of comparisons)
    if ([node.left, node.right].some(operand => values.get(operand)?.zero) &&
        !['COMPARE_DISTINCT_FROM', 'COMPARE_NOT_DISTINCT_FROM'].includes(node.type))
      zeroPredicates.add(node);
  // One exact C085 proof: a direct ordinary comparison with an evaluated
  // numeric-zero operand. Scope success is required before credit.
  for (const [index, statement] of (ast.statements ?? []).entries()) {
    if (negatedStatements.has(index)) continue;
    const query = statement.node;
    if (query.type !== 'SELECT_NODE') continue;
    for (const predicate of predicateRoots(query))
      if (zeroPredicates.has(predicate) &&
          plainQuery(query, query.where_clause === predicate ? predicate : null) &&
          [predicate.left, predicate.right].every(operand => plainColumn(operand) || constantOnly(operand)))
        addProof(result, map, 'zero', '$.predicate');
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
  // Every ON conjunct must be a resolved cross-input column equality. Finding
  // one acceptable equality anywhere in a larger condition is insufficient.
  const exactKeys = join => {
    const conditions = conjuncts(join.node.condition);
    if (!conditions.length) return [];
    const keys = [];
    for (const eq of conditions) {
      if (eq.type !== 'COMPARE_EQUAL' || !plainColumn(eq.left) || !plainColumn(eq.right)) return [];
      const a = facts.references.get(eq.left), b = facts.references.get(eq.right);
      const right = join.left.includes(a?.input) && join.right.includes(b?.input) ? b :
        join.left.includes(b?.input) && join.right.includes(a?.input) ? a : null;
      if (!right) return [];
      keys.push(right);
    }
    return keys;
  };
  const windowCTEConsumer = (query, expression) => {
    const root = query.root, entry = query.cte;
    if (!entry || root.type !== 'SELECT_NODE' || !plainQuery(root, root.where_clause) ||
        root.from_table.type !== 'BASE_TABLE' || fold(root.from_table.table_name) !== fold(entry.key) ||
        root.from_table.schema_name || root.from_table.catalog_name ||
        !root.select_list.every(node => plainColumn(node) || node.class === 'STAR')) return false;
    const index = query.outputPositions.get(expression);
    const refersToWindow = node => {
      const ref = facts.references.get(node);
      return ref?.index === index && fold(ref.input.name) === fold(root.from_table.alias || entry.key);
    };
    const predicate = root.where_clause;
    if (!predicate) return root.select_list.some(node => node.class === 'STAR' || refersToWindow(node));
    // The listed C034 filter is the taught ROW_NUMBER pattern: WHERE rn = 1.
    return expression.type === 'WINDOW_ROW_NUMBER' && predicate.type === 'COMPARE_EQUAL' &&
      [[predicate.left, predicate.right], [predicate.right, predicate.left]].some(([column, one]) =>
        plainColumn(column) && refersToWindow(column) && one.class === 'CONSTANT' &&
        !one.value.is_null && one.value.value === 1);
  };
  for (const query of facts.queries) {
    if (negatedStatements.has(query.statementIndex)) continue;
    const node = query.node;
    for (const expression of node.select_list)
      if (query.inCTE && plainQuery(node) && plainWindow(expression) && windowCTEConsumer(query, expression))
        prove('window_cte');
    // A nested or CTE-local pattern cannot prove a different outer query.
    if (node !== query.root) continue;
    const grouped = node.group_expressions.length &&
      node.group_expressions.every(plainColumn) && plainQuery(node, null, true) &&
      node.select_list.every(expression => plainProjection(expression) || plainAggregate(expression)) &&
      node.select_list.some(plainAggregate);
    const rootJoin = query.joins.find(join => join.node === node.from_table);
    if (grouped && rootJoin && ['INNER', 'LEFT'].includes(rootJoin.node.join_type) &&
        exactKeys(rootJoin).length && query.joins.length === 1) prove('join_group');
    for (const expression of node.select_list) {
      if (grouped && plainAggregate(expression) && fold(expression.function_name) === 'count_star')
        prove('group_count');
      if (plainQuery(node) && plainWindow(expression) && fold(expression.function_name) === 'sum' &&
          expression.orders.length && expression.orders.every(order => plainColumn(order.expression) &&
            ['ASCENDING', 'ORDER_DEFAULT'].includes(order.type)) &&
          expression.orders.some(order => !expression.partitions.some(partition =>
            same(facts.references.get(order.expression), facts.references.get(partition)))) &&
          expression.start === 'UNBOUNDED_PRECEDING' && !expression.start_expr && !expression.end_expr &&
          ['CURRENT_ROW_RANGE', 'CURRENT_ROW_ROWS', 'CURRENT_ROW_GROUPS'].includes(expression.end))
        prove('running_sum_proof');
    }
    if (!rootJoin || rootJoin.node.join_type !== 'LEFT' || query.joins.length !== 1 ||
        !node.select_list.every(plainProjection) || !plainQuery(node, node.where_clause)) continue;
    const predicate = node.where_clause;
    if (predicate?.type !== 'OPERATOR_IS_NULL' || predicate.children.length !== 1) continue;
    if (exactKeys(rootJoin).some(right => same(facts.references.get(predicate.children[0]), right))) {
      prove('orphan_proof');
      prove('unmatched_null');
    }
  }
  result.concepts = [...new Set(result.concepts)].sort();
  result.confirmed = [...new Set(result.confirmed)].sort();
  result.used = [...new Set(result.used)];
  return result;
}

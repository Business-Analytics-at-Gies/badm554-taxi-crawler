// Reviewed vocabulary for the pinned DuckDB 1.5.4 serializer. There is no
// catch-all field, enum, function, or neutral default. Entries describe one
// construct (one id) or an explicitly neutral representation (zero ids).
const entries = {};
const put = (key, id = null, confidence = 'confirmed', child = null) => {
  if (entries[key]) throw new Error(`Duplicate concept map key ${key}`);
  entries[key] = { ids: id ? [id] : [], confidence, child };
};
const field = (owner, name, values) => {
  for (const [value, id, child] of values) put(`${owner}.${name}:${value}`, id, 'confirmed', child);
};
const exact = (owner, name, values, id = null) =>
  field(
    owner,
    name,
    values.map((v) => [JSON.stringify(v), id]),
  );
const scalar = (owner, name, type) => field(owner, name, [[`$${type}`]]);
const object = (owner, name, child = 'auto', id = null, nullable = false) => {
  field(owner, name, [['object', id, child]]);
  if (nullable) exact(owner, name, [null]);
};
const list = (owner, name, child, id = null, nonempty = true) => {
  field(owner, name, [['empty', null, child], ...(nonempty ? [['nonempty', id, child]] : [])]);
};
const type = (owner, name) => {
  put(`object:${owner}`);
  exact(owner, 'type', [name]);
};
put('object:root');
exact('root', 'error', [false]);
list('root', 'statements', 'statement');
put('object:statement');
object('statement', 'node');
list('statement', 'named_param_map', 'auto', null, false);
put('object:cte_map');
list('cte_map', 'map', 'cte_entry', 'C033');
put('object:cte_entry');
scalar('cte_entry', 'key', 'string');
object('cte_entry', 'value', 'cte_value');
put('object:cte_value');
list('cte_value', 'aliases', 'string');
object('cte_value', 'query', 'statement');
exact('cte_value', 'materialized', ['CTE_MATERIALIZE_DEFAULT']);
list('cte_value', 'key_targets', 'auto', null, false);
for (const owner of ['SELECT_NODE', 'SET_OPERATION_NODE']) {
  type(owner, owner);
  list(owner, 'modifiers', 'auto');
  object(owner, 'cte_map', 'cte_map');
}
list('SELECT_NODE', 'select_list', 'auto');
object('SELECT_NODE', 'from_table');
for (const [name, id] of [
  ['where_clause', 'C007'],
  ['having', 'C024'],
  ['qualify', 'C035'],
])
  object('SELECT_NODE', name, 'auto', id, true);
list('SELECT_NODE', 'group_expressions', 'auto', 'C021');
// Ordinary GROUP BY serializes its one grouping set as integer indexes. Multiple
// sets, ROLLUP and CUBE are intentionally unmapped (even with familiar columns).
field('SELECT_NODE', 'group_sets', [
  ['empty', null, 'group_set'],
  ['one', null, 'group_set'],
]);
exact('SELECT_NODE', 'aggregate_handling', ['STANDARD_HANDLING']);
exact('SELECT_NODE', 'sample', [null]);
exact('SET_OPERATION_NODE', 'setop_type', ['UNION']);
field('SET_OPERATION_NODE', 'setop_all', [
  ['true', 'UNION_ALL'],
  ['false', 'UNION'],
]);
object('SET_OPERATION_NODE', 'left');
object('SET_OPERATION_NODE', 'right');
for (const owner of ['EMPTY', 'BASE_TABLE', 'SUBQUERY', 'JOIN', 'EXPRESSION_LIST']) {
  type(owner, owner);
  scalar(owner, 'alias', 'string');
  exact(owner, 'sample', [null]);
  scalar(owner, 'query_location', 'number');
}
exact('BASE_TABLE', 'schema_name', ['', 'main']);
exact('BASE_TABLE', 'catalog_name', ['']);
scalar('BASE_TABLE', 'table_name', 'string');
list('BASE_TABLE', 'column_name_alias', 'string');
exact('BASE_TABLE', 'at_clause', [null]);
object('SUBQUERY', 'subquery', 'statement', 'C032');
list('SUBQUERY', 'column_name_alias', 'string');
object('JOIN', 'left');
object('JOIN', 'right');
object('JOIN', 'condition', 'auto', null, true);
field('JOIN', 'join_type', [
  ['"INNER"', 'C014'],
  ['"LEFT"', 'C015'],
  ['"RIGHT"', 'C017'],
  ['"OUTER"', 'C017'],
  ['"FULL"', 'C017'],
]);
exact('JOIN', 'ref_type', ['REGULAR', 'CROSS']);
list('JOIN', 'using_columns', 'string', null, false);
exact('JOIN', 'delim_flipped', [false]);
list('JOIN', 'duplicate_eliminated_columns', 'auto', null, false);
list('EXPRESSION_LIST', 'expected_names', 'string', null, false);
list('EXPRESSION_LIST', 'expected_types', 'auto', null, false);
list('EXPRESSION_LIST', 'values', 'row_values', 'C003');
for (const owner of [
  'COLUMN_REF',
  'CONSTANT',
  'STAR',
  'FUNCTION',
  'WINDOW',
  'COMPARISON',
  'CONJUNCTION',
  'OPERATOR',
  'CAST',
  'CASE',
  'BETWEEN',
  'SUBQUERY_EXPR',
]) {
  put(`object:${owner}`);
  exact(owner, 'class', [owner === 'SUBQUERY_EXPR' ? 'SUBQUERY' : owner]);
  scalar(owner, 'alias', 'string');
  scalar(owner, 'query_location', 'number');
}
exact('COLUMN_REF', 'type', ['COLUMN_REF']);
list('COLUMN_REF', 'column_names', 'string');
exact('CONSTANT', 'type', ['VALUE_CONSTANT']);
object('CONSTANT', 'value', 'value');
put('object:value');
object('value', 'type', 'logical_type');
exact('value', 'is_null', [true, false]);
// Literal payloads are data, never enums. Their type has its own closed map.
field('value', 'value', [['$number'], ['$string'], ['$boolean']]);
put('object:logical_type');
exact('logical_type', 'id', [
  'NULL',
  'BOOLEAN',
  'INTEGER',
  'BIGINT',
  'HUGEINT',
  'DOUBLE',
  'FLOAT',
  'VARCHAR',
  'DECIMAL',
  'DATE',
  'TIME',
  'TIMESTAMP',
  'INTERVAL',
]);
object('logical_type', 'type_info', 'auto', null, true);
type('DECIMAL_TYPE_INFO', 'DECIMAL_TYPE_INFO');
scalar('DECIMAL_TYPE_INFO', 'alias', 'string');
exact('DECIMAL_TYPE_INFO', 'extension_info', [null]);
scalar('DECIMAL_TYPE_INFO', 'width', 'number');
scalar('DECIMAL_TYPE_INFO', 'scale', 'number');
exact('STAR', 'type', ['STAR']);
scalar('STAR', 'relation_name', 'string');
for (const f of ['exclude_list', 'replace_list', 'qualified_exclude_list', 'rename_list'])
  list('STAR', f, 'auto', null, false);
exact('STAR', 'columns', [false]);
exact('STAR', 'expr', [null]);
exact('FUNCTION', 'type', ['FUNCTION']);
exact('WINDOW', 'type', [
  'WINDOW_AGGREGATE',
  'WINDOW_ROW_NUMBER',
  'WINDOW_RANK',
  'WINDOW_RANK_DENSE',
  'WINDOW_LAG',
  'WINDOW_LEAD',
]);
for (const owner of ['FUNCTION', 'WINDOW']) {
  scalar(owner, 'function_name', 'string');
  exact(owner, 'schema', ['', 'main']);
  exact(owner, 'catalog', ['']);
  list(owner, 'children', 'auto');
}
object('FUNCTION', 'filter', 'auto', 'AGGREGATE_FILTER', true);
object('FUNCTION', 'order_bys', 'aggregate_order');
exact('FUNCTION', 'distinct', [false]);
field('FUNCTION', 'distinct', [['true:count', 'COUNT_DISTINCT']]);
exact('FUNCTION', 'is_operator', [true, false]);
exact('FUNCTION', 'export_state', [false]);
// ORDER BY inside aggregate and window-specific FILTER need separate teaching.
put('object:aggregate_order');
exact('aggregate_order', 'type', ['ORDER_MODIFIER']);
list('aggregate_order', 'orders', 'order', null, false);
list('WINDOW', 'partitions', 'auto', 'C026');
list('WINDOW', 'orders', 'order', 'C027');
exact('WINDOW', 'start', ['UNBOUNDED_PRECEDING']);
field('WINDOW', 'start', [
  ['"EXPR_PRECEDING_ROWS"', 'C027'],
  ['"CURRENT_ROW_ROWS"', 'C027'],
  ['"EXPR_FOLLOWING_ROWS"', 'C027'],
  ['"EXPR_PRECEDING_RANGE"', 'C027'],
  ['"EXPR_FOLLOWING_RANGE"', 'C027'],
  ['"EXPR_PRECEDING_GROUPS"', 'C027'],
  ['"UNBOUNDED_FOLLOWING"', 'C027'],
]);
exact('WINDOW', 'end', ['CURRENT_ROW_RANGE']);
field('WINDOW', 'end', [
  ['"CURRENT_ROW_ROWS"', 'C027'],
  ['"EXPR_PRECEDING_ROWS"', 'C027'],
  ['"EXPR_FOLLOWING_ROWS"', 'C027'],
  ['"UNBOUNDED_FOLLOWING"', 'C027'],
  ['"CURRENT_ROW_GROUPS"', 'C027'],
]);
for (const f of ['start_expr', 'end_expr']) object('WINDOW', f, 'auto', 'C027', true);
for (const f of ['offset_expr', 'default_expr']) object('WINDOW', f, 'auto', null, true);
exact('WINDOW', 'ignore_nulls', [false]);
exact('WINDOW', 'filter_expr', [null]);
exact('WINDOW', 'exclude_clause', ['NO_OTHER']);
exact('WINDOW', 'distinct', [false]);
list('WINDOW', 'arg_orders', 'order', null, false);
exact('COMPARISON', 'type', [
  'COMPARE_EQUAL',
  'COMPARE_NOTEQUAL',
  'COMPARE_LESSTHAN',
  'COMPARE_GREATERTHAN',
  'COMPARE_LESSTHANOREQUALTO',
  'COMPARE_GREATERTHANOREQUALTO',
  'COMPARE_DISTINCT_FROM',
  'COMPARE_NOT_DISTINCT_FROM',
]);
object('COMPARISON', 'left');
object('COMPARISON', 'right');
exact('CONJUNCTION', 'type', ['CONJUNCTION_AND', 'CONJUNCTION_OR']);
list('CONJUNCTION', 'children', 'auto');
exact('OPERATOR', 'type', ['OPERATOR_NOT', 'COMPARE_IN', 'COMPARE_NOT_IN']);
field('OPERATOR', 'type', [['"OPERATOR_COALESCE"', 'C020']]);
// Null tests participate in context-sensitive C016/C083/C085 rules below.
exact('OPERATOR', 'type', ['OPERATOR_IS_NULL', 'OPERATOR_IS_NOT_NULL']);
list('OPERATOR', 'children', 'auto');
exact('CAST', 'type', ['OPERATOR_CAST']);
object('CAST', 'child');
object('CAST', 'cast_type', 'logical_type');
exact('CAST', 'try_cast', [false]);
exact('CASE', 'type', ['CASE_EXPR'], 'CASE_WHEN');
list('CASE', 'case_checks', 'case_check');
object('CASE', 'else_expr');
put('object:case_check');
object('case_check', 'when_expr');
object('case_check', 'then_expr');
exact('BETWEEN', 'type', ['COMPARE_BETWEEN'], 'C085');
for (const f of ['input', 'lower', 'upper']) object('BETWEEN', f);
exact('SUBQUERY_EXPR', 'type', ['SUBQUERY'], 'C032');
exact('SUBQUERY_EXPR', 'subquery_type', ['SCALAR', 'EXISTS', 'ANY']);
object('SUBQUERY_EXPR', 'subquery', 'statement');
object('SUBQUERY_EXPR', 'child', 'auto', null, true);
exact('SUBQUERY_EXPR', 'comparison_type', ['INVALID', 'COMPARE_EQUAL']);
for (const owner of ['ORDER_MODIFIER', 'LIMIT_MODIFIER', 'DISTINCT_MODIFIER']) type(owner, owner);
list('ORDER_MODIFIER', 'orders', 'order', 'C008');
object('LIMIT_MODIFIER', 'limit', 'auto', 'C008', true);
exact('LIMIT_MODIFIER', 'offset', [null]);
list('DISTINCT_MODIFIER', 'distinct_on_targets', 'auto', 'SELECT_DISTINCT', false);
// DISTINCT itself is required even though its target list is empty.
entries['DISTINCT_MODIFIER.type:"DISTINCT_MODIFIER"'].ids = ['SELECT_DISTINCT'];
put('object:order');
exact('order', 'type', ['ORDER_DEFAULT', 'ASCENDING', 'DESCENDING']);
exact('order', 'null_order', ['ORDER_DEFAULT']);
object('order', 'expression');
for (const [name, arity, id] of [
  ['count_star', 0, 'C010'],
  ['count', 1, 'C022'],
  ['sum', 1, 'C022'],
  ['avg', 1, 'C022'],
  ['min', 1, 'C022'],
  ['max', 1, 'C022'],
  ['round', 1, 'ROUND'],
  ['round', 2, 'ROUND'],
  ['date_part', 2, 'EXTRACT'],
  ['row_number', 0, 'C028'],
  ['rank', 0, 'C028'],
  ['dense_rank', 0, 'C028'],
  ['lag', 1, 'C030'],
  ['lag', 2, 'C030'],
  ['lag', 3, 'C030'],
  ['lead', 1, 'C030'],
  ['lead', 2, 'C030'],
  ['lead', 3, 'C030'],
  // Arithmetic is familiar query syntax; list/row construction and unreviewed
  // overloads remain unmapped. Parser rewrites unary + and - to these calls.
  ['+', 1, null],
  ['+', 2, null],
  ['-', 1, null],
  ['-', 2, null],
  ['*', 2, null],
  ['/', 2, null],
])
  put(`function:${name}/${arity}`, id);
for (const [name, id, confidence] of [
  ['select', 'C005', 'confirmed'],
  ['from', 'C006', 'confirmed'],
  ['join_key', 'C013', 'possible'],
  ['null_test', 'C085', 'confirmed'],
  ['null_after_join', 'C016', 'possible'],
  ['unmatched_null', 'C016', 'confirmed'],
  ['orphan', 'C083', 'possible'],
  ['orphan_proof', 'C083', 'confirmed'],
  ['zero', 'C085', 'confirmed'],
  ['date', 'C085', 'confirmed'],
  ['window', 'C025', 'confirmed'],
  ['window_cte', 'C034', 'confirmed'],
  ['running_sum', 'C029', 'possible'],
  ['running_sum_proof', 'C029', 'confirmed'],
  ['join_group', 'C023', 'confirmed'],
  ['group_count', 'C022', 'confirmed'],
])
  put(`rule:${name}`, id, confidence);
export const CONCEPT_MAP = {
  entries,
  keywords: Object.fromEntries(
    `SELECT FROM WHERE AS WITH VALUES JOIN LEFT RIGHT FULL OUTER INNER ON AND OR NOT IS NULL TRUE FALSE GROUP BY HAVING ORDER ASC DESC LIMIT DISTINCT OVER PARTITION ROWS RANGE GROUPS BETWEEN UNBOUNDED PRECEDING FOLLOWING CURRENT ROW CASE WHEN THEN ELSE END UNION ALL FILTER IN DATE TIME TIMESTAMP INTERVAL CAST INTEGER INT BIGINT DOUBLE DECIMAL VARCHAR EXTRACT YEAR COALESCE QUALIFY COMMIT ROLLBACK ZONE NAME LABEL`
      .split(' ')
      .map((w) => [w, true]),
  ),
  phrases: Object.fromEntries(
    [
      ['SELECT DISTINCT', 'SELECT_DISTINCT'],
      ['DISTINCT', 'SELECT_DISTINCT'],
      ['GROUP BY', 'C021'],
      ['LEFT JOIN', 'C015'],
      ['UNION ALL', 'UNION_ALL'],
      ['CASE', 'CASE_WHEN'],
      ['COMMIT', null],
      ['ROLLBACK', null],
    ].map(([phrase, id]) => [phrase, { ids: id ? [id] : [], confidence: 'possible' }]),
  ),
};
for (const kind of ['row_values', 'group_set'])
  for (const state of ['empty', 'nonempty']) put(`array:${kind}:${state}`);

put('name:inline');

// The bound layer only refuses; it never supplies concept or refresher credit.
for (const cls of [
  'BOUND_REF',
  'BOUND_CONSTANT',
  'BOUND_CAST',
  'BOUND_FUNCTION',
  'BOUND_AGGREGATE',
  'BOUND_WINDOW',
  'BOUND_COMPARISON',
  'BOUND_CONJUNCTION',
  'BOUND_OPERATOR',
  'BOUND_CASE',
  'BOUND_BETWEEN',
])
  put(`bound-class:${cls}`);
for (const [fn, arity] of [
  ['seq_scan', 0],
  ['count_star', 0],
  ['count', 1],
  ['sum', 1],
  ['avg', 1],
  ['min', 1],
  ['max', 1],
  ['round', 1],
  ['round', 2],
  ['row_number', 0],
  ['rank', 0],
  ['dense_rank', 0],
  ['lag', 1],
  ['lead', 1],
  ['+', 1],
  ['+', 2],
  ['-', 1],
  ['-', 2],
  ['*', 2],
  ['/', 2],
])
  put(`bound-function:${fn}/${arity}`);

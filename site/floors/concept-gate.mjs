// Trusted, versioned content only. Detection inspects SQL; refresher proof also
// executes its example through the learner runner on a fresh copy of its givens.
import { lessonStatements } from '../game/db/lesson-policy.mjs';
import { detectTokenContext } from './sql-context.mjs';
const literal = sql => `'${sql.replaceAll("'", "''")}'`;

export function parseGraph(csv) {
  const rows = []; let row = [], cell = '', quoted = false;
  for (let i = 0; i < csv.length; i++) {
    const ch = csv[i];
    if (ch === '"') {
      if (quoted && csv[i + 1] === '"') { cell += '"'; i++; }
      else quoted = !quoted;
    } else if (!quoted && (ch === ',' || ch === '\n' || ch === '\r')) {
      row.push(cell); cell = '';
      if (ch !== ',') {
        if (row.some(Boolean)) rows.push(row);
        row = [];
        if (ch === '\r' && csv[i + 1] === '\n') i++;
      }
    } else cell += ch;
  }
  if (quoted) throw new Error('Unclosed CSV quote');
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const header = rows.shift();
  if (header?.join(',') !== 'ConceptID,ConceptName,TaughtIn') throw new Error('Expected the three learning-graph columns');
  const graph = {};
  for (const fields of rows) {
    if (fields.length !== 3 || graph[fields[0]]) throw new Error('Invalid or duplicate graph row');
    graph[fields[0]] = Object.fromEntries(header.map((key, i) => [key, fields[i]]));
  }
  return graph;
}

function fromAST(ast) {
  const found = new Set(),
    add = (id) => found.add(id);
  const zero = (node) =>
    node?.class === 'CONSTANT' &&
    !node.value?.is_null &&
    typeof node.value?.value !== 'string' &&
    Number(node.value?.value) === 0;
  const bindCTEs = (node, env) => {
    if (!node?.cte_map?.map?.length) return env;
    const next = new Map(env);
    for (const e of node.cte_map.map) next.set(e.key.toLowerCase(), e.value.query.node);
    return next;
  };
  const inputJoins = (node, env, seen = new Set()) => {
    if (!node || typeof node !== 'object' || seen.has(node)) return { join: false, left: false };
    seen.add(node);
    env = bindCTEs(node, env);
    if (node.type === 'BASE_TABLE' && !node.schema_name && env.has(node.table_name?.toLowerCase()))
      return inputJoins(env.get(node.table_name.toLowerCase()), env, seen);
    const result = {
      join: node.type === 'JOIN',
      left: node.type === 'JOIN' && node.join_type === 'LEFT',
    };
    // Follow table inputs and set-operation inputs, not scalar subqueries or
    // unrelated statements. This also handles JOIN -> CTE -> GROUP/NULL check.
    for (const key of ['node', 'from_table', 'subquery', 'left', 'right']) {
      const child = inputJoins(node[key], env, seen);
      result.join ||= child.join;
      result.left ||= child.left;
    }
    return result;
  };
  const visit = (node, inCTE = false, scope = null, inFrame = false, bindings = new Map()) => {
    if (!node || typeof node !== 'object') return;
    const entries = node.cte_map?.map ?? [];
    bindings = bindCTEs(node, bindings);
    if (entries.length || node.type === 'RECURSIVE_CTE_NODE') add('C033');
    for (const entry of entries) visit(entry.value.query, true, null, false, bindings);
    const select = node.type === 'SELECT_NODE';
    if (select) {
      scope = {
        group: !!node.group_expressions?.length,
        ...inputJoins(node.from_table, bindings),
        nullTest: false,
      };
      inFrame = false;
      add('C005');
      if (node.from_table && node.from_table.type !== 'EMPTY') add('C006');
      if (node.where_clause) add('C007');
      if (scope.group) add('C021');
      if (node.having) add('C024');
      if (node.qualify) add('C035');
      if (
        node.modifiers?.some(
          (m) => (m.type === 'ORDER_MODIFIER' && m.orders?.length) || m.type === 'LIMIT_MODIFIER',
        )
      )
        add('C008');
    }
    if (node.type === 'EXPRESSION_LIST') add('C003');
    if (node.type === 'SUBQUERY' || node.class === 'SUBQUERY') add('C032');
    if (node.type === 'DISTINCT_MODIFIER') add('SELECT_DISTINCT');
    if (['OPERATOR_IS_NULL', 'OPERATOR_IS_NOT_NULL'].includes(node.type)) {
      add('C016');
      add('C085');
      if (scope) scope.nullTest = true;
    }
    if (node.type === 'OPERATOR_COALESCE') add('C020');
    if (
      node.class === 'BETWEEN' ||
      (node.class === 'COMPARISON' && (zero(node.left) || zero(node.right)))
    )
      add('C085');
    if (node.class === 'CASE') add('CASE_WHEN');
    if (
      node.class === 'CAST' &&
      !inFrame &&
      /^(?:DATE|TIME|TIMESTAMP|TIMESTAMP_TZ|TIME_TZ|INTERVAL)/.test(node.cast_type?.id ?? '')
    )
      add('C085');
    if (node.type === 'SET_OPERATION_NODE' && node.setop_type === 'UNION' && node.setop_all) {
      add('UNION_ALL');
      add('C036');
    }
    if (node.type === 'JOIN') {
      if (scope) scope.join = true;
      if (node.condition || node.using_columns?.length) add('C013');
      if (node.join_type === 'LEFT') {
        add('C015');
        if (scope) scope.left = true;
      }
      if (['RIGHT', 'FULL'].includes(node.join_type)) add('C017');
      if (node.join_type === 'INNER') add('C014');
    }
    const fn = node.function_name?.toLowerCase();
    if (fn === 'count_star') {
      add('C010');
      if (scope?.group) add('C022');
    }
    if (['sum', 'avg', 'min', 'max', 'count'].includes(fn)) add('C022');
    if (fn === 'count' && node.distinct) add('COUNT_DISTINCT');
    if (fn === 'coalesce') add('C020');
    if (fn === 'round') add('ROUND');
    if (['extract', 'date_part'].includes(fn)) add('C036');
    if (['read_csv', 'read_csv_auto', 'csv_scan', 'read_parquet', 'parquet_scan'].includes(fn))
      add('C052');
    if (['row_number', 'rank', 'dense_rank'].includes(fn)) add('C028');
    if (['lag', 'lead'].includes(fn)) add('C030');
    if ((node.filter || node.filter_expr) && node.function_name) add('AGGREGATE_FILTER');
    if (node.class === 'WINDOW') {
      add('C025');
      if (node.partitions?.length) add('C026');
      if (node.orders?.length || node.start_expr || node.end_expr) add('C027');
      if (fn === 'sum' && node.orders?.length) add('C029');
      if (inCTE) add('C034');
    }
    for (const [key, child] of Object.entries(node)) {
      if (key === 'cte_map' || !child || typeof child !== 'object') continue;
      const frame =
        (node.class === 'WINDOW' && ['start_expr', 'end_expr'].includes(key)) || inFrame;
      const childFrame = node.class === 'COMPARISON' || node.class === 'BETWEEN' ? false : frame;
      if (Array.isArray(child)) child.forEach((x) => visit(x, inCTE, scope, childFrame, bindings));
      else visit(child, inCTE, scope, childFrame, bindings);
    }
    if (select) {
      if (scope.group && scope.join) add('C023');
      if (scope.left && scope.nullTest) add('C083');
    }
  };
  visit(ast);
  return [...found].sort();
}

export async function detectSQL(conn, sql) {
  const table = await conn.query(`SELECT system.main.json_serialize_sql(${literal(sql)}) AS ast`);
  const ast = JSON.parse(table.toArray()[0].ast);
  // Structural tokens cover unfinished SQL, DDL and unused window definitions.
  // Complete SELECT expressions are classified from DuckDB's native tree.
  const tokens = await detectTokenContext(conn, sql);
  if (!ast.error) {
    // Native ASTs resolve named/inherited windows and distinguish clauses. Only
    // window-definition syntax (which can be unused and omitted from the AST)
    // supplements the tree; generic keyword matches never override its context.
    return { concepts: [...new Set([...fromAST(ast), ...tokens.filter(id => ['C026','C027'].includes(id))])].sort(), method: 'parser' };
  }
  // The pinned serializer supports SELECT-family ASTs. Valid DDL returns its
  // explicit 'not implemented' response; both that case and partial teaching SQL
  // use native tokens. A tokenizer/connection failure is reported by the gate.
  return { concepts: tokens, method: 'tokens' };
}

const decode = html => html.replace(/&(?:lt|gt|amp|quot|#39);/g, s => ({'&lt;':'<','&gt;':'>','&amp;':'&','&quot;':'"','&#39;':"'"}[s]));
export function sqlSources(pack) {
  const sources = [{ source: 'reference', sql: pack.referenceSql ?? '' }];
  for (const lesson of pack.refresher ?? []) sources.push({ source: `refresher: ${lesson.title}`, sql: lesson.sql ?? '' });
  for (const [i, match] of [...(pack.guide ?? '').matchAll(/<code\b[^>]*>([\s\S]*?)<\/code>/gi)].entries()) {
    sources.push({ source: `guide SQL ${i + 1}`, sql: decode(match[1].replace(/<[^>]*>/g, ' ')) });
  }
  const walk = (value, path) => {
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      if (['outline', 'sql'].includes(key) && typeof child === 'string') sources.push({ source: `${path}.${key}`, sql: child });
      else if (child && typeof child === 'object') walk(child, `${path}.${key}`);
    }
  };
  walk(pack.hints, 'hint');
  return sources.filter(item => item.sql.trim());
}

export async function checkConcepts(conn, pack, graph, overrides) {
  const errors = [], detected = [];
  const declared = new Set(pack.concepts ?? []), refreshed = new Set();
  const module = /^M([1-9]\d*)$/.exec(pack.module ?? '');
  if (!module) errors.push('Missing or invalid module');
  if (!declared.size) errors.push('Missing concepts');
  if (!pack.referenceSql?.trim()) errors.push('Missing reference SQL');
  if (!pack.refreshes || Array.isArray(pack.refreshes)) errors.push('Missing refreshes');
  for (const source of sqlSources(pack)) {
    try { detected.push({ source: source.source, ...await detectSQL(conn, source.sql) }); }
    catch (e) { errors.push(`${source.source}: SQL inspection failed: ${e.message}`); }
  }
  if (!detected.some(item => item.source === 'reference' && item.concepts.length)) errors.push('Empty reference concept scan');
  for (const item of detected) for (const id of item.concepts) {
    if (!declared.has(id)) errors.push(`${item.source}: undeclared ${id}`);
  }
  const executed = new Map();
  for (const [id, title] of Object.entries(pack.refreshes ?? {})) {
    if (!declared.has(id)) errors.push(`Refresher ${id} must also be declared`);
    const lessons = (pack.refresher ?? []).filter(l => l.title === title);
    if (lessons.length !== 1) { errors.push(`${id}: refresher ${title} is missing or ambiguous`); continue; }
    const proof = detected.find(item => item.source === `refresher: ${title}`);
    if (!proof?.concepts.includes(id)) errors.push(`${id}: refresher ${title} does not demonstrate the concept`);
    else {
      if (!executed.has(title)) {
        let failure = null;
        try {
          await lessonStatements(conn, lessons[0].sql);
          const { runLesson } = await import('../game/db/db.js');
          const result = await runLesson(pack, lessons[0].sql);
          failure = result.error ?? null;
        } catch (e) { failure = e.message; }
        executed.set(title, failure);
      }
      const failure = executed.get(title);
      if (failure) errors.push(`${id}: refresher ${title} does not run: ${failure}`);
      else refreshed.add(id);
    }
  }
  for (const id of declared) {
    if (!graph[id] && !overrides[id]?.reason) { errors.push(`Unknown concept ${id}`); continue; }
    const taught = graph[id]?.TaughtIn ?? '';
    const modules = [...taught.matchAll(/(?:^|[,;\s])M(\d+)/g)].map(m => Number(m[1]));
    const prior = taught === 'S0' || module && modules.some(n => n <= Number(module[1]));
    if ((!prior || overrides[id]) && !refreshed.has(id)) errors.push(`${id}: not taught by ${pack.module}; needs a demonstrated local refresher`);
  }
  return { errors: [...new Set(errors)], detected };
}

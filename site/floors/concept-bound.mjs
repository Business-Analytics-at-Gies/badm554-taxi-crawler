import { CONCEPT_MAP } from './concept-map.mjs';
import { blankVariants } from './sql-blanks.mjs';
import { nativeTokens } from '../game/db/sql.js';
import { inspectTree } from './concept-tree.mjs';
import { inspectScope, scopePreflight } from './concept-scope.mjs';
const qi = (name) => `"${name.replaceAll('"', '""')}"`;
const literal = (sql) => `'${sql.replaceAll("'", "''")}'`;
export function inspectBoundPlan(plan, map = CONCEPT_MAP) {
  const errors = [],
    used = new Set();
  const require = (key) => {
    if (!map.entries[key])
      errors.push(`unmapped bound ${key.replace(/^bound-(?:class|function):/, '')}`);
    else used.add(key);
  };
  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    if (Object.hasOwn(node, 'expression_class'))
      require(`bound-class:${node.expression_class}`);
    if (
      ['BOUND_FUNCTION', 'BOUND_AGGREGATE'].includes(node.expression_class) ||
      (node.expression_class === 'BOUND_WINDOW' && Object.hasOwn(node, 'name')) ||
      node.type === 'LOGICAL_GET'
    ) {
      const arity =
        node.type === 'LOGICAL_GET' ? node.arguments?.length : node.children?.length;
      require(`bound-function:${node.name}/${arity}`);
    }
    Object.values(node).forEach(walk);
  };
  walk(plan);
  return { errors: [...new Set(errors)], used: [...used] };
}
// Reject foreign inputs before asking the binder to open a file/catalog view.
// Nonrecursive CTE bodies see preceding entries, never their own name.
function foreignInput(ast, tables) {
  const given = new Set(tables.map((n) => n.toLowerCase()));
  let foreign = null;
  const visit = (node, scope = new Set()) => {
    if (!node || typeof node !== 'object') return;
    const local = new Set(scope);
    for (const entry of node.cte_map?.map ?? []) {
      visit(entry.value.query, local);
      local.add(entry.key.toLowerCase());
    }
    if (
      node.type === 'BASE_TABLE' &&
      (node.schema_name ||
        node.catalog_name ||
        (!given.has(node.table_name.toLowerCase()) &&
          !local.has(node.table_name.toLowerCase())))
    )
      foreign = node.table_name;
    for (const [key, child] of Object.entries(node))
      if (key !== 'cte_map' && child && typeof child === 'object') {
        if (Array.isArray(child)) child.forEach((c) => visit(c, local));
        else visit(child, local);
      }
  };
  visit(ast);
  return foreign;
}
export function unusedCTEs(ast) {
  const definitions = [],
    roots = [];
  const analyse = (node, env, owner) => {
    if (!node || typeof node !== 'object') return;
    const local = new Map(env);
    for (const entry of node.cte_map?.map ?? []) {
      const record = { name: entry.key, deps: new Set() };
      definitions.push(record);
      analyse(entry.value.query, local, record);
      local.set(entry.key.toLowerCase(), record);
    }
    if (node.type === 'BASE_TABLE' && !node.schema_name && !node.catalog_name) {
      const target = local.get(node.table_name.toLowerCase());
      if (target) owner.deps.add(target);
    }
    for (const [key, child] of Object.entries(node))
      if (key !== 'cte_map' && child && typeof child === 'object') {
        if (Array.isArray(child)) child.forEach((c) => analyse(c, local, owner));
        else analyse(child, local, owner);
      }
  };
  for (const statement of ast.statements ?? []) {
    const root = { deps: new Set() };
    roots.push(root);
    analyse(statement, new Map(), root);
  }
  const reached = new Set(),
    visit = (node) => {
      if (reached.has(node)) return;
      reached.add(node);
      node.deps.forEach(visit);
    };
  roots.forEach(visit);
  return definitions.filter((d) => !reached.has(d)).map((d) => `unused CTE ${d.name}`);
}
export async function checkBound(
  conn,
  sql,
  {
    expression = false,
    nameContext = {},
    ast,
    queryBlanks = [],
    referenceSql,
    map = CONCEPT_MAP,
  } = {},
) {
  const schema = nameContext.schemas ?? {},
    tables = Object.keys(schema);
  const fresh = await conn.bindings.connect();
  try {
    const reference = referenceSql?.trim().replace(/;\s*$/, '');
    if (reference && queryBlanks.length) {
      const parsed = JSON.parse(
        (
          await fresh.query(
            `SELECT system.main.json_serialize_sql(${literal(reference)}) AS ast`,
          )
        ).toArray()[0].ast,
      );
      const errors = parsed.error
        ? [`unmapped construct reference fill: ${parsed.error_message}`]
        : inspectTree(parsed, map, nameContext).errors;
      for (const token of await nativeTokens(conn, reference))
        if (token.type === 4) {
          const word = token.text.match(/^[A-Za-z_][A-Za-z_0-9$]*/)?.[0].toUpperCase();
          if (!Object.hasOwn(map.keywords, word))
            errors.push(`unmapped keyword ${word}; quote it if it is a name`);
        }
      if (errors.length) return { errors, used: [] };
    }
    for (const [i, [table, columns]] of Object.entries(schema).entries()) {
      let backing = `__concept_empty_${i}`;
      while (tables.includes(backing)) backing += '_';
      await fresh.query(
        `CREATE TEMP TABLE ${qi(backing)} (${columns.map((c) => `${qi(c.name)} ${c.type}`).join(', ')})`,
      );
      await fresh.query(
        `CREATE TEMP VIEW ${qi(table)} AS SELECT ${columns.map((c) => qi(c.name)).join(', ')} FROM ${qi(backing)}`,
      );
    }
    const columnNames = [
      ...new Set(
        Object.values(schema)
          .flat()
          .map((c) => qi(c.name)),
      ),
    ];
    const choices = [
      'NULL',
      ...columnNames,
      'SELECT NULL',
      ...tables.map((t) => `SELECT * FROM ${qi(t)}`),
    ];
    let failure = 'no candidate binds',
      failureScope = [];
    for (const filled of await blankVariants(conn, sql, (index) =>
      reference && queryBlanks.includes(index) ? [`\n${reference}\n`, ...choices] : choices,
    )) {
      const candidates = expression
        ? tables.length
          ? tables.map((t) => `SELECT ${filled}\nFROM ${qi(t)}`)
          : [`SELECT ${filled}`]
        : [filled];
      for (const candidate of candidates) {
        try {
          const parsed = JSON.parse(
            (
              await fresh.query(
                `SELECT system.main.json_serialize_sql(${literal(candidate)}) AS ast`,
              )
            ).toArray()[0].ast,
          );
          if (parsed.error) {
            failure = parsed.error_message;
            continue;
          }
          const foreign = foreignInput(parsed, tables);
          if (foreign) {
            failure = `use a given table or a visible CTE, not ${foreign}`;
            continue;
          }
          const rows = await fresh.query(
            `SELECT system.main.json_serialize_plan(${literal(candidate)}, optimize := false) AS plan`,
          );
          const plan = JSON.parse(rows.toArray()[0].plan);
          if (plan.error) {
            failure = plan.error_message;
            failureScope = await inspectScope(parsed, schema);
            continue;
          }
          const unused = unusedCTEs(parsed);
          const scopeFacts = { references: new Map(), queries: [] };
          const scope = await inspectScope(
            parsed,
            schema,
            async (node, env) => {
              const copy = structuredClone(node);
              copy.cte_map = {
                map: [...env.values()].map((value) => value.entry),
              };
              const ast = {
                error: false,
                statements: [{ node: copy, named_param_map: [] }],
              };
              const normalize = (value) => {
                if (!value || typeof value !== 'object') return;
                if ('query_location' in value) value.query_location = 0;
                Object.values(value).forEach(normalize);
              };
              normalize(ast);
              const sql = (
                await fresh.query(
                  `SELECT system.main.json_deserialize_sql(${literal(JSON.stringify(ast))}) AS sql`,
                )
              ).toArray()[0].sql;
              return (await fresh.query(`DESCRIBE ${sql}`))
                .toArray()
                .map((row) => row.column_name);
            },
            scopeFacts,
          );
          const preflight = await scopePreflight(conn, parsed);
          const bound = inspectBoundPlan(plan, map);
          return {
            ...bound,
            errors: [...new Set([...bound.errors, ...unused, ...preflight, ...scope])],
            boundSql: candidate,
            scopeFacts: scope.length ? null : scopeFacts,
          };
        } catch (e) {
          failure = e.message;
        }
      }
    }
    return { errors: [`cannot bind: ${failure}`, ...failureScope], used: [] };
  } finally {
    await fresh.close();
  }
}

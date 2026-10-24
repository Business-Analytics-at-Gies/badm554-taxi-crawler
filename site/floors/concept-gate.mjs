import { lessonStatements } from '../game/db/lesson-policy.mjs';
import { nativeTokens, nativeStatements } from '../game/db/sql.js';
import { CONCEPT_MAP } from './concept-map.mjs';
import { checkBound, inspectBoundPlan } from './concept-bound.mjs';
import { blankVariants } from './sql-blanks.mjs';
import { inspectTree, detectComputedZeros } from './concept-tree.mjs';
export { CONCEPT_MAP, inspectTree, inspectBoundPlan };
const literal = (sql) => `'${sql.replaceAll("'", "''")}'`;

export function parseGraph(csv) {
  const rows = [];
  let row = [],
    cell = '',
    quoted = false;
  for (let i = 0; i < csv.length; i++) {
    const ch = csv[i];
    if (ch === '"') {
      if (quoted && csv[i + 1] === '"') {
        cell += '"';
        i++;
      } else quoted = !quoted;
    } else if (!quoted && (ch === ',' || ch === '\n' || ch === '\r')) {
      row.push(cell);
      cell = '';
      if (ch !== ',') {
        if (row.some(Boolean)) rows.push(row);
        row = [];
        if (ch === '\r' && csv[i + 1] === '\n') i++;
      }
    } else cell += ch;
  }
  if (quoted) throw new Error('Unclosed CSV quote');
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  const header = rows.shift();
  if (header?.join(',') !== 'ConceptID,ConceptName,TaughtIn')
    throw new Error('Expected the three learning-graph columns');
  const graph = {};
  for (const fields of rows) {
    if (fields.length !== 3 || graph[fields[0]]) throw new Error('Invalid or duplicate graph row');
    graph[fields[0]] = Object.fromEntries(header.map((key, i) => [key, fields[i]]));
  }
  return graph;
}

// Text outside code markup is intentionally prose, per R3b 3a.
const decode = (html) =>
  html.replace(
    /&(?:lt|gt|amp|quot|apos|#39|#96);/g,
    (s) =>
      ({
        '&lt;': '<',
        '&gt;': '>',
        '&amp;': '&',
        '&quot;': '"',
        '&apos;': "'",
        '&#39;': "'",
        '&#96;': '`',
      })[s],
  );
export function markedSources(text, source) {
  const out = [];
  let i = 0;
  // Match the outer pre first, so pre/code pairs are one source, not two.
  const rest = String(text ?? '').replace(
    /<pre\b[^>]*>([\s\S]*?)<\/pre>|<code\b[^>]*>([\s\S]*?)<\/code>/gi,
    (_, pre, code) => {
      out.push({
        source: `${source} SQL ${++i}`,
        sql: decode((pre ?? code).replace(/<[^>]*>/g, ' ')),
        kind: pre === undefined ? 'inline' : 'pre',
      });
      return ' ';
    },
  );
  for (const m of rest.matchAll(/`([^`]+)`/g))
    out.push({
      source: `${source} SQL ${++i}`,
      sql: decode(m[1]),
      kind: 'inline',
    });
  const residue = rest.replace(/`([^`]+)`/g, ' ');
  if (/<\/?(?:code|pre)\b|`/i.test(residue))
    out.push({ source: `${source} incomplete code markup`, sql: residue, kind: 'inline' });
  return out;
}
export function sqlSources(pack) {
  const out = [{ source: 'reference', sql: pack.referenceSql ?? '', kind: 'complete' }];
  for (const l of pack.refresher ?? [])
    out.push({
      source: `refresher: ${l.title}`,
      sql: l.sql ?? '',
      kind: 'complete',
      lesson: true,
    });
  const walk = (value, path) => {
    if (typeof value === 'string') {
      out.push(...markedSources(value, path));
      return;
    }
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      if (['referenceSql', 'checkSource', 'generatedGuide'].includes(key)) continue;
      if ((key === 'sql' && path.startsWith('pack.refresher')) || key === 'outline') {
        if (key === 'outline') out.push({ source: `${path}.${key}`, sql: child, kind: 'complete' });
      } else
        walk(
          child,
          path === 'pack' && key === 'guide'
            ? 'guide'
            : path === 'pack' && key === 'hints'
              ? 'hint'
              : `${path}.${key}`,
        );
    }
  };
  walk(pack, 'pack');
  if (pack.generatedGuide) out.push(...markedSources(pack.generatedGuide, 'built guide'));
  // The builder supplies decoded JS literal fragments (including template
  // fragments) without executing check.js. Scan all of them, conservatively,
  // rather than guessing which branch might display a message.
  for (const [i, text] of (pack.checkMessages ?? []).entries())
    out.push(...markedSources(text, `check.js message ${i + 1}`));
  return out;
}
const rewriteMessage = 'Rewrite it so that each blank stands for one name, value or query.';
async function filledSources(conn, sql) {
  return [...(await blankVariants(conn, sql, (i) => [`__concept_blank_${i}`, 'SELECT NULL']))];
}
async function parse(conn, sql) {
  try {
    const statements = await nativeStatements(conn, sql);
    if (!statements.length) return null;
    const table = await conn.query(`SELECT system.main.json_serialize_sql(${literal(sql)}) AS ast`);
    const ast = JSON.parse(table.toArray()[0].ast);
    if (ast.error && ast.error_type !== 'not implemented') return null;
    return { ast, sql };
  } catch {
    return null;
  }
}
export async function detectSQL(
  conn,
  sql,
  { kind = 'complete', map = CONCEPT_MAP, nameContext = {} } = {},
) {
  const errors = [],
    used = [],
    concepts = [],
    confirmed = [];
  const tokens = await nativeTokens(conn, sql);
  for (const t of tokens)
    if (t.type === 4) {
      const word = t.text.match(/^[A-Za-z_][A-Za-z_0-9$]*/)?.[0].toUpperCase();
      if (!Object.hasOwn(map.keywords, word))
        errors.push(`unmapped keyword ${word}; quote it if it is a name`);
      else used.push(`keyword:${word}`);
    }
  const phrase = sql.trim().replace(/\s+/g, ' ').toUpperCase();
  if (['inline', 'pre'].includes(kind) && Object.hasOwn(map.phrases, phrase)) {
    used.push(`phrase:${phrase}`);
    concepts.push(...map.phrases[phrase].ids);
    return {
      errors,
      concepts,
      confirmed,
      used,
      method: 'phrase',
      kind: 'phrase',
    };
  }
  // Removing a used phrase must not let a command/keyword become a bare name.
  const name = /^(?:[a-z_][a-z_0-9$]*|"(?:[^"]|"")+")(?:\.(?:[a-z_][a-z_0-9$]*|"(?:[^"]|"")+"))*$/i;
  const candidates = await filledSources(conn, sql);
  let selected = null,
    sourceKind = 'complete';
  for (const candidate of candidates) {
    const r = await parse(conn, candidate);
    if (r) {
      selected = r;
      break;
    }
  }
  if (!selected && kind === 'inline' && name.test(sql.trim())) {
    const wrapped = await parse(conn, `SELECT ${sql}`);
    const ref = wrapped?.ast.statements?.[0]?.node?.select_list?.[0];
    if (ref?.class === 'COLUMN_REF') {
      const value = ref.column_names.at(-1).toLowerCase();
      const allowed = new Set(
        [
          ...(nameContext.columns ?? []),
          ...(nameContext.tables ?? []),
          ...(nameContext.defined ?? []),
        ].map((n) => n.toLowerCase()),
      );
      if (!allowed.has(value) && value !== '___') errors.push(`unknown name ${value}`);
      const entry = map.entries['name:inline'];
      if (!entry) errors.push(`unmapped construct inline name: ${value}`);
      else used.push('name:inline');
      return { errors, concepts, confirmed, used, method: 'name', kind: 'name' };
    }
  }
  if (!selected && ['inline', 'pre'].includes(kind))
    for (const candidate of candidates) {
      const r = await parse(conn, `SELECT ${candidate}`);
      if (r) {
        selected = r;
        sourceKind = 'expression';
        break;
      }
    }
  if (!selected) {
    errors.push(rewriteMessage);
    return { errors, concepts, confirmed, used, method: 'rejected', kind };
  }
  if (selected.ast.error) {
    errors.push(`unmapped construct $: ${selected.ast.error_message}`);
    return {
      errors,
      concepts,
      confirmed,
      used,
      method: 'rejected',
      kind: sourceKind,
    };
  }
  const tree = await detectComputedZeros(
    conn,
    selected.ast,
    inspectTree(selected.ast, map, nameContext),
    map,
  );
  const bound =
    errors.length || tree.errors.length
      ? { errors: [], used: [] }
      : await checkBound(conn, sql, {
          expression: sourceKind === 'expression',
          nameContext,
          ast: selected.ast,
          map,
        });
  return {
    ...tree,
    boundSql: bound.boundSql,
    errors: [...errors, ...tree.errors, ...bound.errors],
    used: [...used, ...tree.used, ...bound.used],
    method: 'parser',
    kind: sourceKind,
  };
}
const nameCaches = new WeakMap();
export async function sourceNameContext(conn, pack) {
  let cache = nameCaches.get(conn);
  if (!cache) {
    cache = new Map();
    nameCaches.set(conn, cache);
  }
  const key = JSON.stringify([pack.id, pack.given ?? {}]);
  if (!cache.has(key)) {
    const columns = new Set(),
      schemas = {},
      tables = Object.keys(pack.given ?? {});
    const { runLesson } = await import('../game/db/db.js');
    for (const table of tables) {
      const result = await runLesson(
        pack,
        `SELECT * FROM "${table.replaceAll('"', '""')}" LIMIT 0`,
      );
      if (result.error) throw new Error(`Cannot inspect given table ${table}: ${result.error}`);
      result.columns.forEach((name) => columns.add(name.toLowerCase()));
      const qi = (name) => `"${name.replaceAll('"', '""')}"`;
      const typeQuery =
        'SELECT ' +
        result.columns
          .map((name) => `typeof((SELECT ${qi(name)} FROM ${qi(table)} LIMIT 1)) AS ${qi(name)}`)
          .join(', ');
      const types = await runLesson(pack, typeQuery);
      if (types.error || types.rows.length !== 1)
        throw new Error(`Cannot inspect given types for ${table}: ${types.error ?? 'no types'}`);
      schemas[table] = result.columns.map((name, i) => ({ name, type: types.rows[0][i] }));
    }
    cache.set(key, { columns: [...columns], tables, schemas, defined: [] });
  }
  return structuredClone(cache.get(key));
}
export async function checkConcepts(conn, pack, graph, overrides, { map = CONCEPT_MAP } = {}) {
  const errors = [],
    detected = [],
    declared = new Set(pack.concepts ?? []),
    refreshed = new Set();
  const module = /^M([1-9]\d*)$/.exec(pack.module ?? '');
  if (!module) errors.push('Missing or invalid module');
  if (!declared.size) errors.push('Missing concepts');
  if (!pack.referenceSql?.trim()) errors.push('Missing reference SQL');
  if (!pack.refreshes || Array.isArray(pack.refreshes)) errors.push('Missing refreshes');
  let nameContext = { columns: [], tables: [], defined: [] };
  try {
    nameContext = await sourceNameContext(conn, pack);
  } catch (e) {
    errors.push(e.message);
  }
  const sources = sqlSources(pack),
    scans = [];
  for (const source of sources) {
    try {
      const result = await detectSQL(conn, source.sql, {
        kind: source.kind,
        map,
        nameContext,
      });
      if (source.lesson) {
        try {
          await lessonStatements(conn, source.sql, Object.keys(pack.given ?? {}));
        } catch (e) {
          result.errors.push(`Lesson does not run: ${e.message}`);
        }
      }
      scans.push({ source, result });
      if (result.kind === 'complete') nameContext.defined.push(...(result.definedNames ?? []));
    } catch (e) {
      errors.push(`${source.source}: SQL inspection failed: ${e.message}`);
    }
  }
  nameContext.defined = [...new Set(nameContext.defined)];
  for (const { source, result: initial } of scans) {
    const result =
      initial.kind === 'name'
        ? await detectSQL(conn, source.sql, { kind: source.kind, map, nameContext })
        : initial;
    detected.push({ source: source.source, ...result });
    for (const e of result.errors) errors.push(`${source.source}: ${e}`);
  }
  if (!detected.some((i) => i.source === 'reference' && i.concepts.length))
    errors.push('Empty reference concept scan');
  for (const item of detected)
    for (const id of item.concepts)
      if (!declared.has(id)) errors.push(`${item.source}: undeclared ${id}`);
  const executed = new Map();
  // Run every authored lesson, including those not named in refreshes.
  for (const lesson of pack.refresher ?? []) {
    const proof = detected.find((i) => i.source === `refresher: ${lesson.title}`);
    let failure = proof?.errors.join('; ') || null;
    if (!failure) {
      try {
        const { runLesson } = await import('../game/db/db.js');
        failure = (await runLesson(pack, lesson.sql)).error ?? null;
      } catch (e) {
        failure = e.message;
      }
    }
    executed.set(lesson.title, failure);
    if (failure) errors.push(`refresher: ${lesson.title}: does not run: ${failure}`);
  }
  for (const [id, title] of Object.entries(pack.refreshes ?? {})) {
    if (!declared.has(id)) errors.push(`Refresher ${id} must also be declared`);
    const lessons = (pack.refresher ?? []).filter((l) => l.title === title);
    if (lessons.length !== 1) {
      errors.push(`${id}: refresher ${title} is missing or ambiguous`);
      continue;
    }
    const proof = detected.find((i) => i.source === `refresher: ${title}`);
    if (!proof?.confirmed.includes(id))
      errors.push(
        `${id}: refresher ${title} does not demonstrate the concept (confirmed proof required)`,
      );
    const failure = executed.get(title);
    if (failure) errors.push(`${id}: refresher ${title} does not run: ${failure}`);
    if (proof?.confirmed.includes(id) && !failure) refreshed.add(id);
  }
  for (const id of declared) {
    if (!graph[id] && !overrides[id]?.reason) {
      errors.push(`Unknown concept ${id}`);
      continue;
    }
    const taught = graph[id]?.TaughtIn ?? '',
      modules = [...taught.matchAll(/(?:^|[,;\s])M(\d+)/g)].map((m) => Number(m[1]));
    const prior = taught === 'S0' || (module && modules.some((n) => n <= Number(module[1])));
    if ((!prior || overrides[id]) && !refreshed.has(id))
      errors.push(`${id}: not taught by ${pack.module}; needs a demonstrated local refresher`);
  }
  return { errors: [...new Set(errors)], detected, nameContext };
}

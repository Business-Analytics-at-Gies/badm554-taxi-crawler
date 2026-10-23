// Content validation only: inspect trusted pack SQL, never execute its statements.
import { nativeTokens } from '../game/db/sql.js';
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
  const found = new Set();
  const add = id => found.add(id);
  const visit = (node, inCTE = false, grouped = false) => {
    if (!node || typeof node !== 'object') return;
    const entries = node.cte_map?.map ?? [];
    if (entries.length || node.type === 'RECURSIVE_CTE_NODE') add('C033');
    for (const entry of entries) visit(entry.value.query, true, false);
    if (node.type === 'SELECT_NODE') {
      add('C005'); grouped = !!node.group_expressions?.length;
      if (node.from_table && node.from_table.type !== 'EMPTY') add('C006');
      if (node.where_clause) add('C007');
      if (grouped) add('C021');
      if (node.having) add('C024');
      if (node.qualify) add('C035');
    }
    if (node.type === 'EXPRESSION_LIST') add('C003');
    if (node.type === 'SUBQUERY' || node.class === 'SUBQUERY') add('C032');
    if (node.type === 'DISTINCT_MODIFIER') add('SELECT_DISTINCT');
    if (node.type === 'ORDER_MODIFIER' && node.orders?.length || node.type === 'LIMIT_MODIFIER') add('C008');
    if (node.type === 'OPERATOR_IS_NULL' || node.type === 'OPERATOR_IS_NOT_NULL') add('C016');
    if (node.class === 'CASE') add('CASE_WHEN');
    if (node.class === 'CAST' && /^TIMESTAMP/.test(node.cast_type?.id ?? '')) add('C085');
    if (node.type === 'SET_OPERATION_NODE' && node.setop_type === 'UNION' && node.setop_all) add('UNION_ALL');
    if (node.type === 'JOIN') {
      if (node.join_type === 'LEFT') add('C015');
      if (['RIGHT', 'FULL'].includes(node.join_type)) add('C017');
      if (node.join_type === 'INNER') add('C014');
    }
    const fn = node.function_name?.toLowerCase();
    if (fn === 'count_star') { add('C010'); if (grouped) add('C022'); }
    if (['sum', 'avg', 'min', 'max', 'count'].includes(fn)) add('C022');
    if (fn === 'count' && node.distinct) add('COUNT_DISTINCT');
    if (fn === 'round') add('ROUND');
    if (['row_number', 'rank', 'dense_rank'].includes(fn)) add('C028');
    if ((node.filter || node.filter_expr) && node.function_name) add('AGGREGATE_FILTER');
    if (node.class === 'WINDOW') {
      add('C025');
      if (node.partitions?.length) add('C026');
      if (node.orders?.length) add('C027');
      if (inCTE) add('C034');
    }
    for (const [key, child] of Object.entries(node)) {
      if (key === 'cte_map' || !child || typeof child !== 'object') continue;
      if (Array.isArray(child)) child.forEach(x => visit(x, inCTE, grouped));
      else visit(child, inCTE, grouped);
    }
  };
  visit(ast);
  return [...found].sort();
}

// DuckDB's tokenizer also accepts unfinished examples. Its token classes keep
// nested comments, E-strings and dollar-quoted strings out of keyword matching.
async function fromTokens(conn, sql) {
  const tokens = (await nativeTokens(conn, sql)).filter(t => ![2, 5].includes(t.type)).map(t => ({
    // Native offsets span trailing comments; inspect only the leading lexeme.
    word: ([0, 4].includes(t.type)
      ? t.text.startsWith('"') ? t.text.match(/^"(?:[^"]|"")*"/)?.[0].slice(1, -1).replaceAll('""', '"') ?? t.text
        : t.text.match(/^[A-Za-z_][A-Za-z_0-9$]*/)?.[0] ?? t.text
      : t.text[0]).toUpperCase(),
    keyword: !t.text.startsWith('"'),
  }));
  const at = (i, word) => tokens[i]?.keyword && tokens[i].word === word;
  const has = word => tokens.some((_, i) => at(i, word));
  const pair = (a, b) => tokens.some((_, i) => at(i, a) && at(i + 1, b));
  const call = fn => tokens.some((t, i) => t.word === fn && tokens[i + 1]?.word === '(');
  const close = start => {
    let depth = 0;
    for (let i = start; i < tokens.length; i++) {
      if (tokens[i].word === '(') depth++;
      if (tokens[i].word === ')' && --depth === 0) return i;
    }
    return tokens.length; // An unfinished body still owns the remaining tokens.
  };
  const ctes = [], windows = [];
  for (let i = 0; i < tokens.length; i++) {
    if (at(i, 'OVER') && tokens[i + 1]?.word === '(') windows.push([i + 1, close(i + 1)]);
    if (!at(i, 'WITH')) continue;
    let j = i + 1;
    if (at(j, 'RECURSIVE')) j++;
    while (j < tokens.length) {
      j++; // CTE name; optionally followed by a column alias list.
      if (tokens[j]?.word === '(') j = close(j) + 1;
      if (!at(j, 'AS')) break;
      j++;
      if (at(j, 'NOT')) j++;
      if (at(j, 'MATERIALIZED')) j++;
      if (tokens[j]?.word !== '(') break;
      const end = close(j);
      ctes.push([j, end]); j = end + 1;
      if (tokens[j]?.word !== ',') break;
      j++;
    }
  }
  const inRange = (i, ranges) => ranges.some(([start, end]) => i > start && i < end);
  const found = new Set(); const add = (ok, id) => { if (ok) found.add(id); };
  for (const [word, id] of [['SELECT','C005'], ['FROM','C006'], ['WHERE','C007'], ['VALUES','C003'],
    ['WITH','C033'], ['QUALIFY','C035'], ['CASE','CASE_WHEN'], ['OVER','C025'], ['HAVING','C024'],
    ['LIMIT','C008'], ['TIMESTAMP','C085']]) add(has(word), id);
  add(pair('CREATE', 'TABLE') || pair('CREATE', 'OR') && pair('REPLACE', 'TABLE'), 'C053');
  add(pair('GROUP', 'BY'), 'C021'); add(pair('ORDER','BY'), 'C008'); add(pair('PARTITION','BY'), 'C026');
  add(tokens.some((_, i) => at(i, 'ORDER') && at(i + 1, 'BY') && inRange(i, windows)), 'C027');
  add(tokens.some((_, i) => at(i, 'OVER') && inRange(i, ctes)), 'C034');
  add(pair('SELECT','DISTINCT'), 'SELECT_DISTINCT');
  add(tokens.some((_, i) => tokens[i].word === 'COUNT' && tokens[i+1]?.word === '(' && at(i+2,'DISTINCT')), 'COUNT_DISTINCT');
  add(pair('UNION','ALL'), 'UNION_ALL'); add(call('FILTER') && has('WHERE'), 'AGGREGATE_FILTER');
  add(pair('IS','NULL') || pair('IS','NOT') && has('NULL'), 'C016');
  add(pair('LEFT','JOIN') || pair('LEFT','OUTER') && has('JOIN'), 'C015');
  add((has('RIGHT') || has('FULL')) && has('JOIN'), 'C017');
  add(has('JOIN') && !has('LEFT') && !has('RIGHT') && !has('FULL'), 'C014');
  add(['ROW_NUMBER','RANK','DENSE_RANK'].some(call), 'C028');
  add(['SUM','AVG','MIN','MAX','COUNT'].some(call), 'C022'); add(call('COUNT'), 'C010'); add(call('ROUND'), 'ROUND');
  return [...found].sort();
}

export async function detectSQL(conn, sql) {
  const table = await conn.query(`SELECT system.main.json_serialize_sql(${literal(sql)}) AS ast`);
  const ast = JSON.parse(table.toArray()[0].ast);
  if (!ast.error) return { concepts: fromAST(ast), method: 'parser' };
  // The pinned serializer supports SELECT-family ASTs. Valid DDL returns its
  // explicit 'not implemented' response; both that case and partial teaching SQL
  // use native tokens. A tokenizer/connection failure is reported by the gate.
  return { concepts: await fromTokens(conn, sql), method: 'tokens' };
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
  for (const [id, title] of Object.entries(pack.refreshes ?? {})) {
    if (!declared.has(id)) errors.push(`Refresher ${id} must also be declared`);
    const lessons = (pack.refresher ?? []).filter(l => l.title === title);
    if (lessons.length !== 1) { errors.push(`${id}: refresher ${title} is missing or ambiguous`); continue; }
    const proof = detected.find(item => item.source === `refresher: ${title}`);
    if (!proof?.concepts.includes(id)) errors.push(`${id}: refresher ${title} does not demonstrate the concept`);
    else refreshed.add(id);
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

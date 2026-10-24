// Structural fallback for unfinished teaching SQL and DDL. Lexemes and offsets
// always come from DuckDB. Query, call, CTE and window scopes give keywords their
// meaning; words inside strings, identifiers or another SELECT cannot leak out.
import { nativeTokens } from '../game/db/sql.js';
export async function contextTokens(conn, sql) {
  return (await nativeTokens(conn, sql))
    .filter((t) => t.type !== 5)
    .map((t) => {
      const quoted = t.text.startsWith('"');
      const lexeme = quoted
        ? t.text.match(/^"(?:[^"]|"")*"/)?.[0]
        : [0, 4].includes(t.type)
          ? t.text.match(/^[A-Za-z_][A-Za-z_0-9$]*/)?.[0]
          : t.type === 1
            ? t.text.match(/^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/)?.[0]
            : t.type === 3
              ? t.text.match(/^(?:<=|>=|<>|!=|::|\S)/)?.[0]
              : t.text;
      return {
        ...t,
        word:
          t.type === 2
            ? null
            : (quoted ? lexeme?.slice(1, -1).replaceAll('""', '"') : lexeme)?.toUpperCase(),
        keyword: !quoted && [0, 4].includes(t.type),
      };
    });
}

export async function detectTokenContext(conn, sql) {
  const t = await contextTokens(conn, sql),
    count = t.length;
  const at = (i, w) => t[i]?.keyword && t[i].word === w;
  const pair = (i, a, b) => at(i, a) && at(i + 1, b);
  const found = new Set(),
    add = (ok, id) => {
      if (ok) found.add(id);
    };
  const stack = [],
    ends = new Map(),
    opens = new Map();
  let depth = 0;
  for (let i = 0; i < count; i++) {
    if (t[i].word === ')') {
      depth--;
      const open = stack.pop();
      if (open !== undefined) {
        ends.set(open, i);
        opens.set(i, open);
      }
    }
    t[i].depth = depth;
    t[i].parents = [...stack];
    if (t[i].word === '(') {
      stack.push(i);
      depth++;
    }
  }
  for (const open of stack) ends.set(open, count);
  const end = (open) => ends.get(open) ?? count;
  const queries = [];
  for (let i = 0; i < count; i++)
    if (
      at(i, 'SELECT') ||
      (['UPDATE', 'DELETE', 'INSERT', 'MERGE'].some((w) => at(i, w)) &&
        (i === 0 || t[i - 1]?.word === ';' || t[i - 1]?.word === ')'))
    ) {
      let stop = count;
      for (let j = i + 1; j < count; j++)
        if (
          t[j].depth < t[i].depth ||
          (t[j].word === ';' && t[j].depth === t[i].depth) ||
          (t[j].depth === t[i].depth && ['UNION', 'EXCEPT', 'INTERSECT'].some((w) => at(j, w)))
        ) {
          stop = j;
          break;
        }
      queries.push({
        head: t[i].word,
        clause: t[i].word,
        start: i,
        end: stop,
        depth: t[i].depth,
        named: new Map(),
        joins: new Set(),
        dependencies: new Set(),
        nullTest: false,
        group: false,
      });
    }
  const owner = (i) =>
    queries
      .filter((q) => i >= q.start && i < q.end)
      .sort((a, b) => b.depth - a.depth || b.start - a.start)[0];
  const ctes = [];
  for (let i = 0; i < count; i++)
    if (at(i, 'WITH')) {
      let j = i + 1;
      if (at(j, 'RECURSIVE')) j++;
      let seen = false,
        blockEnd = count;
      for (let k = i + 1; k < count; k++)
        if (t[k].depth < t[i].depth || (t[k].word === ';' && t[k].depth === t[i].depth)) {
          blockEnd = k;
          break;
        }
      while (j < count) {
        const name = t[j]?.word;
        j++;
        if (t[j]?.word === '(') j = end(j) + 1;
        if (!at(j, 'AS')) break;
        j++;
        if (at(j, 'NOT')) j++;
        if (at(j, 'MATERIALIZED')) j++;
        if (t[j]?.word !== '(') break;
        ctes.push([j, end(j), name, i, blockEnd]);
        seen = true;
        j = end(j) + 1;
        if (t[j]?.word !== ',') break;
        j++;
      }
      add(seen || i === 0 || t[i - 1]?.word === '(' || t[i - 1]?.word === ';', 'C033');
    }
  const inCTE = (i) => ctes.some(([a, b]) => i > a && i < b);
  const spec = (open) => ({
    start: open,
    end: end(open),
    base:
      t[open + 1] &&
      [0, 4].includes(t[open + 1].type) &&
      !['PARTITION', 'ORDER', 'ROWS', 'RANGE', 'GROUPS'].some((w) => at(open + 1, w))
        ? t[open + 1].word
        : null,
  });
  const direct = (i, r) =>
    i > r.start && i < r.end && t[i].depth === t[r.start].depth + 1 && owner(i) === owner(r.start);
  const frameStarts = new Map();
  const frameStart = (r) => {
    if (frameStarts.has(r)) return frameStarts.get(r);
    const expectsOperand = new Set([
      'BY',
      ',',
      '.',
      '+',
      '-',
      '*',
      '/',
      '%',
      '=',
      '<',
      '>',
      '<=',
      '>=',
      '<>',
      '!=',
      'AND',
      'OR',
      'NOT',
      'WHEN',
      'THEN',
      'ELSE',
      'AS',
      'IS',
      'COLLATE',
    ]);
    let start = null;
    for (let i = r.start + 1; i < r.end; i++) {
      if (!direct(i, r) || !['ROWS', 'RANGE', 'GROUPS'].some((w) => at(i, w))) continue;
      if (i !== r.start + 1 && (expectsOperand.has(t[i - 1]?.word) || t[i - 1]?.word === '('))
        continue;
      if ([')', ',', '*', '/', '=', '<', '>'].includes(t[i + 1]?.word)) continue;
      start = i;
      break;
    }
    frameStarts.set(r, start);
    return start;
  };
  const definitions = [];
  for (let i = 0; i < count; i++)
    if (at(i, 'WINDOW')) {
      const q = owner(i);
      if (!q || t[i].depth !== q.depth) continue;
      let j = i + 1;
      while (t[j] && at(j + 1, 'AS') && t[j + 2]?.word === '(') {
        const r = spec(j + 2);
        q.named.set(t[j].word, r);
        definitions.push(r);
        j = r.end + 1;
        if (t[j]?.word !== ',') break;
        j++;
      }
    }
  const resolve = (q, r, seen = new Set()) => {
    if (!r) return [];
    const key = r.base;
    if (!key || seen.has(key)) return [r];
    seen.add(key);
    return [...resolve(q, q?.named.get(key), seen), r];
  };
  const calls = new Map();
  const structural = new Set([
    'SELECT',
    'WITH',
    'AS',
    'OVER',
    'FILTER',
    'VALUES',
    'IN',
    'EXISTS',
    'USING',
    'BY',
    'GROUP',
    'ON',
    'WHERE',
    'HAVING',
    'QUALIFY',
  ]);
  for (let i = 0; i < count - 1; i++)
    if (
      [0, 4].includes(t[i].type) &&
      t[i + 1].word === '(' &&
      (!t[i].keyword || !structural.has(t[i].word))
    )
      calls.set(i + 1, { fn: t[i].word, start: i + 1, end: end(i + 1), name: i });
  const callBefore = (i) => {
    let open = opens.get(i - 1),
      call = calls.get(open);
    if (t[open - 1]?.word === 'FILTER') {
      open = opens.get(open - 2);
      call = calls.get(open);
    }
    return call;
  };
  const windows = [];
  for (let i = 0; i < count; i++)
    if (at(i, 'OVER')) {
      const call = callBefore(i),
        q = owner(i);
      if (!call || !q) continue;
      const r = t[i + 1]?.word === '(' ? spec(i + 1) : q.named.get(t[i + 1]?.word);
      const ranges = resolve(q, r);
      windows.push({ at: i, fn: call.fn, ranges });
      add(true, 'C025');
      add(inCTE(i), 'C034');
      add(
        ranges.some((r) => t.some((_, j) => direct(j, r) && pair(j, 'PARTITION', 'BY'))),
        'C026',
      );
      const ordered = ranges.some((r) => t.some((_, j) => direct(j, r) && pair(j, 'ORDER', 'BY')));
      add(ordered || ranges.some((r) => frameStart(r) !== null), 'C027');
      add(call.fn === 'SUM' && ordered, 'C029');
    }
  // Definitions can teach a clause even before an unfinished OVER refers to it.
  const ranges = [...definitions, ...windows.flatMap((w) => w.ranges)];
  for (const r of ranges) {
    add(
      t.some((_, i) => direct(i, r) && pair(i, 'PARTITION', 'BY')),
      'C026',
    );
    add(t.some((_, i) => direct(i, r) && pair(i, 'ORDER', 'BY')) || frameStart(r) !== null, 'C027');
  }
  const frame = (i) =>
    ranges.some(
      (r) =>
        frameStart(r) !== null && i > frameStart(r) && i < r.end && owner(i) === owner(r.start),
    );
  const frameBetween = (i) =>
    ranges.some((r) => frameStart(r) !== null && i === frameStart(r) + 1 && at(i, 'BETWEEN'));
  const cases = [],
    conditions = [];
  for (let i = 0; i < count; i++) {
    if (at(i, 'CASE')) cases.push({ query: owner(i), when: null });
    else if (at(i, 'WHEN') && cases.length) cases.at(-1).when = i;
    else if (at(i, 'THEN') && cases.at(-1)?.when !== null && cases.length) {
      conditions.push([cases.at(-1).when, i, cases.at(-1).query]);
      cases.at(-1).when = null;
    } else if (at(i, 'END')) cases.pop();
  }
  for (const c of cases) if (c.when !== null) conditions.push([c.when, count, c.query]);
  const condition = (i) => conditions.some(([a, b, q]) => i > a && i < b && owner(i) === q);
  const enclosingCall = (i, fn) =>
    t[i].parents.some((open) => calls.get(open)?.fn === fn && owner(open) === owner(i));
  for (const q of queries) {
    add(q.head === 'SELECT', 'C005');
    for (let i = q.start + 1; i < q.end; i++) {
      if (owner(i) !== q) continue;
      const directQuery = t[i].depth === q.depth;
      if (directQuery) {
        if (['SET', 'WHERE', 'HAVING', 'QUALIFY', 'ON', 'WHEN'].some((w) => at(i, w)))
          q.clause = t[i].word;
        if ((at(i, 'FROM') && !at(i - 1, 'DISTINCT')) || at(i, 'JOIN')) {
          let j = i + 1;
          if (at(j, 'LATERAL')) j++;
          let inputs = [];
          if (t[j]?.word === '(')
            inputs = queries.filter((other) => other.start > j && other.start < end(j));
          else if (t[j + 1]?.word !== '.' && t[j + 1]?.word !== '(') {
            const cte = ctes
              .filter(
                ([a, b, name, start, stop]) =>
                  name === t[j]?.word && q.start >= start && q.start < stop,
              )
              .sort((a, b) => b[3] - a[3])[0];
            if (cte)
              inputs = queries.filter((other) => other.start > cte[0] && other.start < cte[1]);
          }
          const min = Math.min(...inputs.map((other) => other.depth));
          for (const input of inputs.filter((other) => other.depth === min))
            q.dependencies.add(input);
        }

        add(at(i, 'FROM') && !at(i - 1, 'DISTINCT'), 'C006');
        add(at(i, 'WHERE'), 'C007');
        add(at(i, 'HAVING'), 'C024');
        add(at(i, 'QUALIFY'), 'C035');
        add(pair(i, 'ORDER', 'BY') || at(i, 'LIMIT') || at(i, 'OFFSET'), 'C008');
        if (pair(i, 'GROUP', 'BY')) {
          q.group = true;
          add(true, 'C021');
        }
        if (at(i, 'JOIN')) {
          let k = i - 1;
          if (at(k, 'OUTER')) k--;
          const kind = ['LEFT', 'RIGHT', 'FULL'].find((w) => at(k, w)) ?? 'INNER';
          q.joins.add(kind);
          add(kind === 'LEFT', 'C015');
          add(['RIGHT', 'FULL'].includes(kind), 'C017');
          add(kind === 'INNER', 'C014');
        }
        add(q.joins.size && (at(i, 'ON') || at(i, 'USING')), 'C013');
      }
      if (pair(i, 'IS', 'NULL') || (at(i, 'IS') && at(i + 1, 'NOT') && at(i + 2, 'NULL'))) {
        q.nullTest = true;
        add(true, 'C016');
        add(true, 'C085');
      }
      add(at(i, 'BETWEEN') && !frameBetween(i), 'C085');
      const castName = ['DATE', 'TIME', 'TIMESTAMP', 'TIMESTAMPTZ', 'TIMETZ', 'INTERVAL'].some(
        (w) => at(i, w),
      );
      add(
        castName &&
          (!frame(i) || condition(i)) &&
          (t[i + 1]?.type === 2 ||
            (t[i + 1]?.word === '(' && !at(i - 1, 'AS')) ||
            (at(i - 1, 'AS') && (enclosingCall(i, 'CAST') || enclosingCall(i, 'TRY_CAST')))),
        'C085',
      );
      if (
        t[i].type === 1 &&
        Number(t[i].word) === 0 &&
        (q.head === 'SELECT' || q.clause !== 'SET' || t[i].depth > q.depth)
      ) {
        const j = ['+', '-'].includes(t[i - 1]?.word) ? i - 2 : i - 1;
        add(
          ['=', '<', '>', '<=', '>=', '<>', '!='].includes(t[j]?.word) ||
            ['=', '<', '>', '<=', '>=', '<>', '!='].includes(t[i + 1]?.word),
          'C085',
        );
      }
    }
  }
  const upstream = (q, seen = new Set()) => {
    if (seen.has(q)) return new Set();
    seen.add(q);
    const joins = new Set(q.joins);
    for (const dep of q.dependencies) for (const kind of upstream(dep, seen)) joins.add(kind);
    return joins;
  };
  for (const q of queries) {
    const joins = upstream(q);
    add(q.group && joins.size, 'C023');
    add(q.nullTest && joins.has('LEFT'), 'C083');
  }
  for (const call of calls.values()) {
    const { fn, start } = call;
    add(fn === 'COUNT' && t[start + 1]?.word === '*', 'C010');
    add(['SUM', 'AVG', 'MIN', 'MAX', 'COUNT'].includes(fn), 'C022');
    add(fn === 'COUNT' && at(start + 1, 'DISTINCT'), 'COUNT_DISTINCT');
    add(['ROW_NUMBER', 'RANK', 'DENSE_RANK'].includes(fn), 'C028');
    add(['LAG', 'LEAD'].includes(fn), 'C030');
    add(fn === 'COALESCE', 'C020');
    add(['EXTRACT', 'DATE_PART'].includes(fn), 'C036');
    add(fn === 'ROUND', 'ROUND');
    add(
      ['READ_CSV', 'READ_CSV_AUTO', 'CSV_SCAN', 'READ_PARQUET', 'PARQUET_SCAN'].includes(fn),
      'C052',
    );
  }
  for (let i = 0; i < count; i++) {
    add(at(i, 'CASE'), 'CASE_WHEN');
    add(at(i, 'VALUES'), 'C003');
    add(pair(i, 'SELECT', 'DISTINCT'), 'SELECT_DISTINCT');
    add(pair(i, 'UNION', 'ALL'), 'UNION_ALL');
    add(pair(i, 'UNION', 'ALL'), 'C036');
    add(
      at(i, 'FILTER') &&
        t[i + 1]?.word === '(' &&
        at(i + 2, 'WHERE') &&
        !!calls.get(opens.get(i - 1)),
      'AGGREGATE_FILTER',
    );
    add(
      t[i].word === '(' &&
        ['SELECT', 'WITH', 'VALUES'].some((w) => at(i + 1, w)) &&
        !ctes.some(([a]) => a === i),
      'C032',
    );
    if (!at(i, 'CREATE') && !at(i, 'DROP') && !at(i, 'ALTER')) continue;
    let j = i + 1;
    const replace = pair(j, 'OR', 'REPLACE');
    if (replace) j += 2;
    if (at(j, 'TEMP') || at(j, 'TEMPORARY')) j++;
    if (!at(j, 'TABLE')) continue;
    add(at(i, 'CREATE'), 'C053');
    add(at(i, 'DROP') || (at(i, 'CREATE') && replace), 'C073');
    let k = j + 1;
    while (k < count && t[k].word !== ';' && !pair(k, 'AS', 'SELECT')) {
      add(
        (t[k].depth > t[i].depth || at(i, 'ALTER')) &&
          (pair(k, 'FOREIGN', 'KEY') || at(k, 'REFERENCES')),
        'C046',
      );
      k++;
    }
  }
  return [...found].sort();
}

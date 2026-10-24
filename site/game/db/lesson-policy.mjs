// R3b: SELECT-family lessons use Answer's native statement/reference/function
// checks. The fresh lesson database and sequential learner runner stay unchanged.
import { nativeStatements, nativeTokens } from './sql.js';
import { answerPolicy } from './answer-policy.js';
export async function lessonStatements(conn, sql, given = null) {
  const refuse = () => {
    throw new Error(
      'Session, transaction, table, catalog, file or state-changing statements are not allowed in lesson SQL.',
    );
  };
  const family = (token) => token?.text.match(/^[A-Za-z_]+/)?.[0].toUpperCase();
  const allowed = ['SELECT', 'WITH', 'VALUES', 'FROM'];
  const groups = [[]];
  for (const token of await nativeTokens(conn, sql)) {
    if (token.type === 5) continue;
    if (token.type === 3 && token.text.startsWith(';')) groups.push([]);
    else groups.at(-1).push(token);
  }
  for (const group of groups) if (group.length && !allowed.includes(family(group[0]))) refuse();
  const statements = await nativeStatements(conn, sql);
  if (!statements.length) throw new Error('The lesson has no statements to run.');
  // At authoring time the caller supplies the pack's givens. In runLesson's
  // fresh database the native table catalog supplies actual disposable tables;
  // system views and file paths cannot masquerade as input tables.
  const tables =
    given ??
    (await conn.query('SELECT table_name FROM system.main.duckdb_tables() WHERE NOT internal'))
      .toArray()
      .map((row) => row.table_name);
  for (const statement of statements) {
    const first = family((await nativeTokens(conn, statement)).find((t) => t.type !== 5));
    if (!allowed.includes(first)) refuse();
    const query = ['VALUES', 'FROM'].includes(first)
      ? `SELECT * FROM (${statement}) AS lesson_query`
      : statement;
    if ((await answerPolicy(conn, query, tables)).error) refuse();
  }
  return statements;
}

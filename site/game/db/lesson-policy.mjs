// A lesson may manipulate its disposable tables, never its execution session.
// Fail closed on other statement families, including indirect/prepared commands.
import { nativeStatements, nativeTokens, nativeReadPolicy } from './sql.js';
const word = (token) =>
  token && [0, 4].includes(token.type) && !token.text.startsWith('"')
    ? token.text.match(/^[A-Za-z_][A-Za-z_0-9$]*/)?.[0].toUpperCase()
    : null;
const refuse = (first) => {
  throw new Error(
    `Session or transaction statements are not allowed in lesson SQL: ${first ?? 'unknown statement'}.`,
  );
};
export async function lessonStatements(conn, sql) {
  // Native token classes distinguish separators from quoted/comment semicolons.
  // Check the family before parsing, so even an unsupported control alias fails
  // with the policy reason. Native parsing still owns the actual statement list.
  const groups = [[]];
  for (const token of await nativeTokens(conn, sql)) {
    if (token.type === 5) continue;
    if (token.type === 3 && token.text.startsWith(';')) groups.push([]);
    else groups.at(-1).push(token);
  }
  for (const tokens of groups.filter((group) => group.length)) {
    const words = tokens.slice(0, 6).map(word),
      first = words[0];
    if (first === 'UPDATE') {
      let depth = 0,
        assignment = false;
      for (const token of tokens) {
        if (token.type === 3 && token.text.startsWith('(')) depth++;
        if (token.type === 3 && token.text.startsWith(')')) depth--;
        if (depth === 0 && word(token) === 'SET') assignment = true;
      }
      if (!assignment) refuse(first);
    }
    if (['SELECT', 'WITH', 'VALUES', 'FROM', 'INSERT', 'UPDATE', 'DELETE', 'MERGE'].includes(first))
      continue;
    let table = false;
    if (first === 'CREATE') {
      let i = 1;
      if (words[i] === 'OR' && words[i + 1] === 'REPLACE') i += 2;
      if (['TEMP', 'TEMPORARY'].includes(words[i])) i++;
      table = words[i] === 'TABLE';
    } else table = ['DROP', 'ALTER'].includes(first) && words[1] === 'TABLE';
    if (!table) refuse(first);
  }
  const statements = await nativeStatements(conn, sql);
  if (!statements.length) throw new Error('The lesson has no statements to run.');
  for (const statement of statements) {
    const first = word((await nativeTokens(conn, statement)).find((token) => token.type !== 5));
    if (['SELECT', 'WITH', 'VALUES', 'FROM'].includes(first)) {
      const policy = await nativeReadPolicy(conn, statement);
      if (!policy.readOnly) refuse(first); // stateful functions and indirect execution
    }
  }
  return statements;
}

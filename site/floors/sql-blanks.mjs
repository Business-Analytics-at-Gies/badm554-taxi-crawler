import { nativeTokens } from '../game/db/sql.js';
// Native byte offsets identify blanks outside strings/comments. Yield lazily:
// callers stop at the first parse/bind success instead of allocating a product.
export async function blankVariants(conn, sql, choices) {
  const tokens = await nativeTokens(conn, sql),
    bytes = new TextEncoder().encode(sql),
    decode = new TextDecoder();
  const parts = [];
  let start = 0;
  for (const token of tokens)
    if (token.type === 0 && /^___\b/.test(token.text)) {
      parts.push(decode.decode(bytes.slice(start, token.start)));
      start = token.start + 3;
    }
  parts.push(decode.decode(bytes.slice(start)));
  function* fill(index, prefix) {
    if (index === parts.length - 1) {
      yield prefix + parts[index];
      return;
    }
    for (const value of choices(index)) yield* fill(index + 1, prefix + parts[index] + value);
  }
  return fill(0, '');
}

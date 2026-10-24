// Conservative static extraction: every JS string and template fragment, not
// just guessed makeRule positions. Never import or execute an authored checker.
// Only a single bounded literal is passed to JavaScript's own parser; template
// expressions are visited statically and never included in the decoded literal.
import { Script } from 'node:vm';
const literalCache = new Map();

export function checkMessageLiterals(source) {
  const result = [];
  let i = 0;
  const literal = (raw, quote) => {
    const token = `${quote}${raw}${quote}`;
    if (!literalCache.has(token))
      literalCache.set(token, new Script(`"use strict"; (${token})`)
        .runInNewContext(Object.create(null), { timeout: 100 }));
    const value = literalCache.get(token);
    if (typeof value !== 'string') throw new Error('Expected a checker string literal');
    result.push(value);
  };
  const string = (quote) => {
    let start = ++i;
    while (i < source.length) {
      const at = i, c = source[i++];
      if (c === quote) {
        literal(source.slice(start, at), quote);
        return;
      }
      if (c === '\\') {
        if (source[i++] === '\r' && source[i] === '\n') i++;
        continue;
      }
      if (quote === '`' && c === '$' && source[i] === '{') {
        i++;
        literal(source.slice(start, at), quote);
        code(true);
        start = i;
      }
    }
    throw new Error('Unclosed checker string');
  };
  const code = (interpolation = false) => {
    let braces = 0;
    while (i < source.length) {
      const c = source[i];
      if (c === '/' && source[i + 1] === '/') {
        const end = source.slice(i + 2).search(/[\n\r\u2028\u2029]/);
        i = end < 0 ? source.length : i + 2 + end;
        continue;
      }
      if (c === '/' && source[i + 1] === '*') {
        const end = source.indexOf('*/', i + 2);
        if (end < 0) throw new Error('Unclosed checker comment');
        i = end + 2;
        continue;
      }
      if (["'", '"', '`'].includes(c)) {
        string(c);
        continue;
      }
      i++;
      if (c === '{') braces++;
      if (c === '}') {
        if (braces === 0 && interpolation) return;
        braces--;
      }
    }
    if (interpolation) throw new Error('Unclosed checker template');
  };
  code();
  return result;
}

// Conservative static extraction: every JS string and template fragment, not
// just guessed makeRule positions. Never import or execute an authored checker.
// Dynamic fragments are inspected recursively; pack strings are scanned too.
export function checkMessageLiterals(source) {
  const result = [];
  let i = 0;
  const escape = () => {
    const c = source[i++];
    if (c === '\n') return '';
    if (c === '\r') {
      if (source[i] === '\n') i++;
      return '';
    }
    if (c === 'x' || c === 'u') {
      const brace = c === 'u' && source[i] === '{';
      if (brace) i++;
      const n = brace ? source.indexOf('}', i) - i : c === 'x' ? 2 : 4;
      const digits = source.slice(i, i + n);
      if (n < 1 || !/^[\da-f]+$/i.test(digits)) throw new Error('Invalid JS string escape');
      i += n + (brace ? 1 : 0);
      return String.fromCodePoint(parseInt(digits, 16));
    }
    return { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', v: '\v', 0: '\0' }[c] ?? c;
  };
  const string = (quote) => {
    i++;
    let text = '';
    while (i < source.length) {
      const c = source[i++];
      if (c === quote) {
        result.push(text);
        return;
      }
      if (c === '\\') {
        text += escape();
        continue;
      }
      if (quote === '`' && c === '$' && source[i] === '{') {
        i++;
        result.push(text);
        text = '';
        code(true);
        continue;
      }
      text += c;
    }
    throw new Error('Unclosed checker string');
  };
  const code = (interpolation = false) => {
    let braces = 0;
    while (i < source.length) {
      const c = source[i];
      if (c === '/' && source[i + 1] === '/') {
        i = source.indexOf('\n', i + 2);
        if (i < 0) i = source.length;
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

// DuckDB-WASM can report errors as JSON ({"exception_type":"Parser","exception_message":"..."}).
// Show them as one plain line: "Parser Error: syntax error at or near ...".
export function friendlyError(e) {
  const s = String(e ?? '');
  const i = s.indexOf('{"exception_type"');
  if (i < 0) return s;
  const j = s.lastIndexOf('}');
  try {
    const o = JSON.parse(s.slice(i, j + 1));
    const msg = `${o.exception_type} Error: ${String(o.exception_message || '').trim()}`;
    return (s.slice(0, i) + msg + s.slice(j + 1)).trim();
  } catch {
    return s;
  }
}

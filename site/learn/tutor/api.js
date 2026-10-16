// Calls to the server (docs/interfaces.md part 1). Errors come back as ApiError with the server's
// code and plain-words message.
export class ApiError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}

export async function call(method, path, body) {
  let res;
  try {
    res = await fetch(path, {
      method, credentials: 'same-origin',
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'network', 'The tutor could not be reached. The game still works.');
  }
  let data = null;
  try { data = await res.json(); } catch { /* not JSON */ }
  if (!res.ok) throw new ApiError(res.status, data?.error || 'upstream_error', data?.message || 'The tutor is not available right now. The game still works.');
  return data;
}

export const get = path => call('GET', path);
export const post = (path, body) => call('POST', path, body);

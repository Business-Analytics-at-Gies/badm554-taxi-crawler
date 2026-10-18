// Explicit test-harness helper: never imported by production routes.
const type = value => value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
function outline(value, path = []) {
  if (Array.isArray(value)) {
    if (path.length === 1 && path[0] === 'tools') return value.map(tool => {
      const result = {};
      for (const key of ['type', 'name']) if (Object.hasOwn(tool, key)) result[key] = typeof tool[key] === 'string' ? tool[key] : type(tool[key]);
      return result;
    });
    return value.map((item, index) => outline(item, [...path, index]));
  }
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, outline(item, [...path, key])]));
  return type(value);
}
module.exports = { outline };

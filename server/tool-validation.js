// Implements only the JSON Schema keywords used by the frozen tools.json.
// Unknown schema types fail closed; inputs stay objects and are never JSON-parsed again.
function validate(schema, value, path = 'input') {
  if (schema.enum && !schema.enum.includes(value)) return `${path} must be one of the allowed values.`;
  switch (schema.type) {
    case 'object': {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return `${path} must be an object.`;
      for (const key of schema.required || []) if (!Object.hasOwn(value, key)) return `${path}.${key} is required.`;
      for (const key of Object.keys(value)) {
        if (!Object.hasOwn(schema.properties || {}, key)) {
          if (schema.additionalProperties === false) return `${path}.${key} is not allowed.`;
        } else {
          const error = validate(schema.properties[key], value[key], `${path}.${key}`);
          if (error) return error;
        }
      }
      return null;
    }
    case 'string':
      if (typeof value !== 'string') return `${path} must be text.`;
      if (schema.maxLength !== undefined && [...value].length > schema.maxLength) return `${path} is too long.`;
      return null;
    case 'integer':
      if (!Number.isSafeInteger(value)) return `${path} must be a whole number.`;
      if ((schema.minimum !== undefined && value < schema.minimum) || (schema.maximum !== undefined && value > schema.maximum)) return `${path} is outside the allowed range.`;
      return null;
    case 'array':
      if (!Array.isArray(value)) return `${path} must be a list.`;
      if (schema.maxItems !== undefined && value.length > schema.maxItems) return `${path} has too many items.`;
      for (let i = 0; i < value.length; i++) {
        const error = validate(schema.items, value[i], `${path}[${i}]`);
        if (error) return error;
      }
      return null;
    default: return `${path} has an unsupported schema.`;
  }
}
module.exports = { validate };

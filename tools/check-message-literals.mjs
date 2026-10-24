// Parse the entire checker as a module. Never import it or execute any authored
// statement, interpolation, tag function or regular expression.
import { createRequire } from 'node:module';
// The pack builder is a development tool; its parser is pinned in tests/db.
const { parse } = createRequire(new URL('../tests/db/package.json', import.meta.url))('acorn');

export function checkMessageLiterals(source) {
  const tree = parse(source, { ecmaVersion: 2025, sourceType: 'module' });
  const literals = [];
  const visit = node => {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'Literal' && typeof node.value === 'string')
      literals.push({ start: node.start, text: node.value });
    if (node.type === 'TemplateElement') {
      // Invalid escapes in tagged templates have no cooked string. Refuse them
      // rather than silently omitting a potentially displayed fragment.
      if (node.value.cooked === null) throw new SyntaxError('Undecodable checker template literal');
      literals.push({ start: node.start, text: node.value.cooked });
    }
    for (const child of Object.values(node)) {
      if (Array.isArray(child)) child.forEach(visit);
      else if (child && typeof child === 'object') visit(child);
    }
  };
  visit(tree);
  return literals.sort((a, b) => a.start - b.start).map(literal => literal.text);
}

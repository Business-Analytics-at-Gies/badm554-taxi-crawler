// Text-safe Markdown: builds DOM nodes with textContent only. Model output never becomes HTML.
// Supports paragraphs, fenced code, - and 1. lists, # headings (as bold lines), **bold**, *em*, `code`.
function inline(parent, text) {
  const re = /(`[^`]+`|\*\*[^*]+\*\*|__[^_]+__|\*[^*\s][^*]*\*)/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index > last) parent.append(text.slice(last, m.index));
    const t = m[0];
    let el;
    if (t.startsWith('`')) { el = document.createElement('code'); el.textContent = t.slice(1, -1); }
    else if (t.startsWith('**') || t.startsWith('__')) { el = document.createElement('strong'); el.textContent = t.slice(2, -2); }
    else { el = document.createElement('em'); el.textContent = t.slice(1, -1); }
    parent.append(el);
    last = m.index + t.length;
  }
  if (last < text.length) parent.append(text.slice(last));
}

export function renderMarkdown(text) {
  const frag = document.createDocumentFragment();
  const lines = String(text ?? '').replace(/\r\n?/g, '\n').split('\n');
  let para = [];
  let list = null;
  const flushPara = () => {
    if (!para.length) return;
    const p = document.createElement('p');
    inline(p, para.join(' '));
    frag.append(p);
    para = [];
  };
  const flushList = () => { if (list) { frag.append(list); list = null; } };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*```/.test(line)) {
      flushPara(); flushList();
      const code = [];
      for (i++; i < lines.length && !/^\s*```/.test(lines[i]); i++) code.push(lines[i]);
      const pre = document.createElement('pre');
      const c = document.createElement('code');
      c.textContent = code.join('\n');
      pre.append(c); frag.append(pre);
      continue;
    }
    const ul = line.match(/^\s*[-*+]\s+(.*)$/);
    const ol = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (ul || ol) {
      flushPara();
      const tag = ul ? 'UL' : 'OL';
      if (!list || list.tagName !== tag) { flushList(); list = document.createElement(tag); }
      const li = document.createElement('li');
      inline(li, (ul || ol)[1]);
      list.append(li);
      continue;
    }
    if (!line.trim()) { flushPara(); flushList(); continue; }
    const h = line.match(/^\s*#{1,6}\s+(.*)$/);
    if (h) {
      flushPara(); flushList();
      const p = document.createElement('p');
      const s = document.createElement('strong');
      s.textContent = h[1];
      p.append(s); frag.append(p);
      continue;
    }
    flushList();
    para.push(line.trim());
  }
  flushPara(); flushList();
  return frag;
}

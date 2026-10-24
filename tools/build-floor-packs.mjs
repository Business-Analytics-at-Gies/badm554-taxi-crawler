// Generate the no-JavaScript guide and compatibility assets from the same packs the engine uses.
// No network calls. Tests can add a pack folder and serve this returned map without changing code.
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkMessageLiterals } from './check-message-literals.mjs';
import { validatePack, RERUN_INSTRUCTION } from '../site/floors/contract.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const read = path => readFile(path, 'utf8');
const html = text => String(text).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const links = list => `<ul class="review-links">${list.map(l => `<li><a href="${html(l.url)}" target="_blank" rel="noopener">${html(l.label)}</a></li>`).join('')}</ul>`;

function taskHtml(pack) {
  const identifiers = new Set([...Object.keys(pack.given), ...pack.outputs, ...Object.values(pack.tables ?? {}).flat().map(c => c.name), 'reason']);
  const text = `${pack.guideTask} ${RERUN_INSTRUCTION}`;
  const marked = text.split(/(CREATE OR REPLACE TABLE|\bDROP\b|\b[a-z][a-z_]*\b)/g).map(s =>
    identifiers.has(s) || s.includes('_') || s === 'CREATE OR REPLACE TABLE' || s === 'DROP' ? `<code>${html(s)}</code>` : html(s)).join('');
  return `${pack.task !== pack.guideTask ? `<p class="task-rules">${html(pack.task)}</p>` : ''}<p class="task"><strong>Your task:</strong> ${marked}</p>`;
}

function guideControls(pack) {
  let guide = pack.guide;
  for (const level of [1, 2, 3]) {
    const content = (pack.controls ?? []).map(control => `<p class="control-${html(control.id)}">${html(control.levels[level - 1])}</p>`).join('');
    if (!content) continue;
    const tag = `<div class="lv" data-lv="${level}">`;
    if (guide.includes(tag)) guide = guide.replace(tag, tag + content);
    else guide = guide.replace('</article>', `<div class="lv" data-lv="${level}">${content}</div></article>`);
  }
  return guide;
}

function aboutData(packs) {
  const data = packs.find(p => p.aboutData)?.aboutData;
  if (!data) throw new Error('Pack table definitions need About the data content');
  const tables = new Map();
  for (const pack of packs) for (const [name, columns] of Object.entries(pack.tables ?? {})) {
    if (tables.has(name) && JSON.stringify(tables.get(name)) !== JSON.stringify(columns)) throw new Error(`Conflicting table definition: ${name}`);
    tables.set(name, columns);
  }
  return `<section id="about-data" aria-labelledby="about-data-h"><h4 id="about-data-h">About the data</h4>
<p>${html(data.description)} ${html(data.loadMetadata)} ${html(data.locations)}</p>
${[...tables].map(([name, columns]) => `<h5>${html(name)}</h5><ul>${columns.map(c => `<li class="data-column"><code>${html(c.name)}</code>: ${html(c.description)}</li>`).join('')}</ul>`).join('\n')}
<p>Source: ${data.sources.map(s => `<a href="${html(s.url)}" target="_blank" rel="noopener">${html(s.label)}</a>`).join(' and ')}. ${html(data.renames)}</p></section>`;
}

export async function buildFloorPacks({ extraPacks = [], write = false } = {}) {
  const dirs = (await readdir(join(ROOT, 'site/floors'), { withFileTypes: true }))
    .filter(d => d.isDirectory() && /^floor\d+$/.test(d.name)).map(d => join(ROOT, 'site/floors', d.name));
  const files = new Map();
  const packs = [];
  for (const dir of [...dirs, ...extraPacks]) {
    const pack = validatePack(JSON.parse(await read(join(dir, 'pack.json'))));
    const path = `site/floors/floor${pack.id}`;
    const contents = {};
    for (const name of ['reference.sql', 'guide.html', 'check.js', 'solutions.json']) {
      contents[name] = await read(join(dir, name));
      if (!contents[name].trim()) throw new Error(`Floor ${pack.id}: empty ${name}`);
      files.set(`${path}/${name}`, contents[name]);
    }
    const solutions = JSON.parse(contents['solutions.json']);
    pack.solutions = Array.isArray(solutions) ? solutions : solutions.cases;
    if (!pack.solutions.some(s => !s.fails.length) || !pack.solutions.some(s => s.fails.length)) throw new Error(`Floor ${pack.id}: valid and wrong solutions required`);
    pack.reference = `/floors/floor${pack.id}/reference.sql`;
    pack.check = `/floors/floor${pack.id}/check.js`;
    pack.guide = contents['guide.html'];
    pack.checkMessages = checkMessageLiterals(contents['check.js']);
    if (!['{{context}}', '{{refresher}}', '{{task}}'].every(token => pack.guide.includes(token))) throw new Error(`Floor ${pack.id}: guide needs context, refresher and task slots`);
    packs.push(pack);
    files.set(`data/reference/floor${pack.id}.sql`, contents['reference.sql']);
  }
  packs.sort((a, b) => a.id - b.id);
  if (new Set(packs.map(p => p.id)).size !== packs.length) throw new Error('Duplicate floor id');
  // Reference sources may depend only on earlier packs, so initialization order is unambiguous.
  const seen = new Set();
  for (const pack of packs) {
    for (const src of Object.values(pack.given)) {
      const dependency = src.match(/^_ref(\d+)\./)?.[1];
      if (dependency && !seen.has(Number(dependency))) throw new Error(`Floor ${pack.id}: reference dependency ${dependency} must come first`);
    }
    seen.add(pack.id);
  }
  const runtime = packs.map(({ solutions, guide, checkMessages, generatedGuide, ...pack }) => pack);
  files.set('site/floors/catalog.js', `// Generated by tools/build-floor-packs.mjs. Edit the source packs.\nimport { validatePack, RERUN_INSTRUCTION } from './contract.mjs';\nexport { RERUN_INSTRUCTION };\nconst packs = ${JSON.stringify(runtime, null, 2)};\nexport const FLOORS = Object.freeze(Object.fromEntries(packs.map(p => [p.id, Object.freeze(validatePack(p))])));\nexport const FLOOR_IDS = Object.freeze(packs.map(p => p.id));\nexport const ROOMS = Object.freeze(['map', ...FLOOR_IDS.map(n => 'floor' + n)]);\nexport const validFloor = n => FLOOR_IDS.includes(n);\nexport const floorError = () => 'Floor must be ' + FLOOR_IDS.slice(0, -1).join(', ') + ' or ' + FLOOR_IDS.at(-1) + '.';\n`);
  const rooms = packs.map(pack => guideControls(pack).replace('{{context}}', `<div class="floor-context" id="f${pack.id}-context"><p>${html(pack.context)}</p></div>`)
    .replace('{{refresher}}', `<section class="floor-refresher" id="f${pack.id}-refresher" aria-labelledby="f${pack.id}-refresher-h"><h4 id="f${pack.id}-refresher-h">SQL refresher</h4>${pack.refresher.map(l => `<h5>${html(l.title)}</h5><p>${html(l.text)}</p><pre><code>${html(l.sql)}</code></pre>`).join('')}<h5>Review in the textbook</h5>${links(pack.reviewLinks)}</section>`)
    .replace('{{task}}', taskHtml(pack))).join('\n');
  for (const pack of packs) pack.generatedGuide = rooms.match(new RegExp(`<section class="room" id="room-floor${pack.id}"[\\s\\S]*?(?=\\n  <section class="room"|$)`))?.[0] ?? '';
  const replacements = {
    floorRooms: rooms,
    floorNav: packs.map(p => `        <li><a href="#room=floor${p.id}" data-room="floor${p.id}">Floor ${p.id}</a></li>`).join('\n'),
    floorCards: `<ol class="floor-cards">${packs.map(p => `<li class="floor-card" data-floor="${p.id}">${p.emblem ? `<img class="floor-emblem" src="${html(p.emblem)}" alt="" aria-hidden="true" width="56" height="56" decoding="async">` : ''}<h4>${html(p.title)}</h4><p>${html(p.card)}</p><p class="cleared" data-cleared-floor="${p.id}" hidden>Cleared</p><p class="card-actions js-only"><button type="button" class="play" data-floor="${p.id}">Start floor ${p.id}</button></p></li>`).join('')}</ol>`,
    aboutData: aboutData(packs),
    floorButtons: packs.map(p => `    <button type="button" data-floor="${p.id}" aria-pressed="false">Floor ${p.id}</button>`).join('\n'),
    floorSummaries: packs.map(p => p.summary).join('\n'),
  };
  for (const [template, out] of [['site/learn/template.html', 'site/learn/index.html'], ['site/game/template.html', 'site/game/index.html'], ['server/prompt.template.md', 'server/prompt.md']]) {
    const source = await read(join(ROOT, template));
    const content = source.replace(/{{(\w+)}}/g, (_, key) => {
      if (!(key in replacements)) throw new Error(`Unknown template slot ${key}`);
      return replacements[key];
    });
    files.set(out, content);
    if (out === 'site/learn/index.html') for (const pack of packs) pack.generatedGuide = content.replace(rooms, '') + '\n' + pack.generatedGuide;
  }
  files.set('site/learn/floors-rules.txt', packs.map(p => p.rulesText.trim()).join('\n\n') + '\n');
  const tools = JSON.parse(await read(join(ROOT, 'server/tools.template.json')));
  tools.find(t => t.name === 'navigate').input_schema.properties.room.enum = ['map', ...packs.map(p => `floor${p.id}`)];
  Object.assign(tools.find(t => t.name === 'game').input_schema.properties.floor, { minimum: packs[0].id, maximum: packs.at(-1).id });
  tools.find(t => t.name === 'show_code').input_schema.properties.file.enum.unshift(...packs.map(p => `floor${p.id}-reference`));
  files.set('server/tools.json', JSON.stringify(tools, null, 2) + '\n');
  if (write) for (const [path, content] of files) {
    const dest = resolve(ROOT, path);
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, content);
  }
  return { files, packs };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { files, packs } = await buildFloorPacks({ write: true });
  console.log(`Built ${packs.length} floor packs (${files.size} static assets).`);
}

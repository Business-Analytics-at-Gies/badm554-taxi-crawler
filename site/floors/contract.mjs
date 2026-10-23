// Packs are trusted, versioned content. Reject incomplete teaching material before publishing it.
export const RERUN_INSTRUCTION = 'Write your answer as one query in the Answer box. A WITH query is fine: the check runs your query and grades its result. You do not need to save a table.';

export function validatePack(pack) {
  const fail = field => { throw new Error(`Floor ${pack?.id ?? '?'}: invalid or missing ${field}`); };
  if (!Number.isSafeInteger(pack?.id) || pack.id < 1) fail('id');
  for (const field of ['title', 'input', 'task', 'guideTask', 'context', 'taskContext', 'summary', 'rulesText', 'dirt']) {
    if (typeof pack[field] !== 'string' || !pack[field].trim()) fail(field);
  }
  if (!/^M[1-9]\d*$/.test(pack.module ?? '')) fail('module');
  if (!Array.isArray(pack.concepts) || !pack.concepts.length || pack.concepts.some(id => typeof id !== 'string' || !/^(C\d{3}|[A-Z][A-Z0-9_]+)$/.test(id)) || new Set(pack.concepts).size !== pack.concepts.length) fail('concepts');
  if (!pack.refreshes || typeof pack.refreshes !== 'object' || Array.isArray(pack.refreshes)) fail('refreshes');
  if (!Array.isArray(pack.ruleIds) || !pack.ruleIds.length
      || pack.ruleIds.some(id => typeof id !== 'string' || !/^[a-z][a-z0-9_]*$/.test(id))
      || new Set(pack.ruleIds).size !== pack.ruleIds.length) fail('ruleIds');
  if (!pack.given || !Object.keys(pack.given).length || !pack.given[pack.input]) fail('given');
  if (!Array.isArray(pack.outputs) || !pack.outputs.length) fail('outputs');
  for (const control of pack.controls ?? []) {
    if (!/^[a-z][a-z-]*$/.test(control.id) || !Array.isArray(control.levels) || control.levels.length !== 3
      || control.levels.some(text => typeof text !== 'string' || !text.trim())) fail('control guide text');
  }
  if (!Array.isArray(pack.refresher) || !pack.refresher.length) fail('refresher');
  for (const lesson of pack.refresher) {
    if (!lesson.title?.trim() || !lesson.text?.trim() || !lesson.sql?.trim()) fail('refresher');
    const lines = lesson.sql.trim().split('\n').length;
    if (lines < 2 || lines > 5) fail('refresher SQL (2 to 5 lines)');
  }
  for (const [id, title] of Object.entries(pack.refreshes)) {
    if (!pack.concepts.includes(id) || typeof title !== 'string' || !pack.refresher.some(l => l.title === title)) fail('refreshes');
  }
  if (!Array.isArray(pack.reviewLinks) || !pack.reviewLinks.length) fail('reviewLinks');
  for (const link of pack.reviewLinks) {
    if (!link.label?.trim()) fail('reviewLinks label');
    let url;
    try { url = new URL(link.url); } catch { fail('reviewLinks https URL'); }
    if (url.protocol !== 'https:') fail('reviewLinks https URL');
  }
  if (!pack.map?.label || !pack.map?.color) fail('map');
  for (const columns of Object.values(pack.tables ?? {})) for (const column of columns) {
    if (!column.name?.trim() || !column.type?.trim() || !column.description?.trim()) fail('table column definition');
  }
  if (pack.aboutData) for (const source of pack.aboutData.sources ?? []) {
    if (!source.label?.trim() || !String(source.url).startsWith('https://')) fail('About the data https source');
  }
  return pack;
}

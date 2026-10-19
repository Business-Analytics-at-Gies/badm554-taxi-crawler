// Packs are trusted, versioned content. Reject incomplete teaching material before publishing it.
export const RERUN_INSTRUCTION = 'Use CREATE OR REPLACE TABLE to run your SQL again without a DROP.';

export function validatePack(pack) {
  const fail = field => { throw new Error(`Floor ${pack?.id ?? '?'}: invalid or missing ${field}`); };
  if (!Number.isSafeInteger(pack?.id) || pack.id < 1) fail('id');
  for (const field of ['title', 'input', 'task', 'guideTask', 'context', 'summary', 'rulesText', 'dirt']) {
    if (typeof pack[field] !== 'string' || !pack[field].trim()) fail(field);
  }
  if (!pack.given || !Object.keys(pack.given).length || !pack.given[pack.input]) fail('given');
  if (!Array.isArray(pack.outputs) || !pack.outputs.length) fail('outputs');
  if (!Array.isArray(pack.refresher) || !pack.refresher.length) fail('refresher');
  for (const lesson of pack.refresher) {
    if (!lesson.title?.trim() || !lesson.text?.trim() || !lesson.sql?.trim()) fail('refresher');
    const lines = lesson.sql.trim().split('\n').length;
    if (lines < 2 || lines > 5) fail('refresher SQL (2 to 5 lines)');
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

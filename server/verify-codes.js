#!/usr/bin/env node
// Run with real grading records only in Codex Edu. Crew tests use synthetic records.
const { readFileSync } = require('node:fs');
const { DatabaseSync } = require('node:sqlite');
const { config } = require('./config');

function parseCsv(source) {
  const rows = [];
  let row = [], field = '', quoted = false, ended = false;
  source = source.replace(/^\uFEFF/, '');
  const pushField = () => { row.push(field); field = ''; ended = false; };
  const pushRow = () => { pushField(); if (row.some(v => v.trim())) rows.push(row); row = []; };
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (quoted) {
      if (c === '"' && source[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') { quoted = false; ended = true; }
      else field += c;
    } else if (c === ',' ) pushField();
    else if (c === '\n' || c === '\r') { if (c === '\r' && source[i + 1] === '\n') i++; pushRow(); }
    else if (c === '"' && field === '' && !ended) quoted = true;
    else {
      if (ended || c === '"') throw new Error('Malformed CSV');
      field += c;
    }
  }
  if (quoted) throw new Error('Unclosed CSV field');
  if (field || row.length || ended) pushRow();
  return rows;
}
function verifyCodes(source, identity, pilot, dataset) {
  const [header, ...rows] = parseCsv(source);
  if (!header) throw new Error('CSV is empty');
  const names = header.map(s => s.trim().toLowerCase());
  if (new Set(names).size !== names.length) throw new Error('Duplicate CSV columns');
  const learnerIndex = names.indexOf('learner'), codeIndex = names.includes('codes') ? names.indexOf('codes') : names.indexOf('code'), ownerIndex = names.indexOf('entra_id');
  if (learnerIndex < 0 || codeIndex < 0) throw new Error('CSV needs learner and code (or codes) columns');
  const lookup = identity.prepare(`SELECT r.floor,s.mode,s.subject FROM receipts r
    LEFT JOIN sessions s ON s.id=r.session WHERE r.code=? AND r.pilot=? AND r.dataset=?`);
  const records = [], uses = new Map(), learners = new Set();
  for (const row of rows) {
    if (row.length !== header.length) throw new Error('CSV row has the wrong number of fields');
    const learner = row[learnerIndex].trim();
    if (!learner) throw new Error('CSV learner is missing');
    learners.add(learner);
    const pasted = row[codeIndex].toUpperCase().trim();
    const codes = pasted.match(/\bTAXI-[123]-[A-Z]{8}\b/g) || [];
    if (!codes.length || pasted.replace(/\bTAXI-[123]-[A-Z]{8}\b/g, '').replace(/[\s,;|]/g, '')) records.push({ learner, code: null, floor: null, ownership: 'unknown', flags: ['invalid_code'] });
    for (const code of new Set(codes)) {
      const receipt = lookup.get(code, pilot, dataset);
      const record = { learner, code, floor: receipt?.floor || null, ownership: 'unknown', flags: [] };
      if (!receipt) record.flags.push('unknown_code');
      else if (receipt.mode === 'entra') {
        record.ownership = 'entra';
        if (ownerIndex < 0 || !row[ownerIndex].trim()) record.flags.push('missing_entra_id');
        else if (row[ownerIndex].trim() !== receipt.subject) record.flags.push('wrong_owner');
      } else if (receipt.mode === 'join') record.ownership = 'session_only';
      else record.flags.push('test_or_missing_identity');
      if (!uses.has(code)) uses.set(code, new Set());
      uses.get(code).add(learner);
      records.push(record);
    }
  }
  const duplicates = [...uses].filter(([, set]) => set.size > 1).map(([code, set]) => ({ code, learners: [...set] }));
  const duplicateCodes = new Set(duplicates.map(d => d.code));
  for (const record of records) if (duplicateCodes.has(record.code)) record.flags.push('shared_code');
  const report = { pilot, dataset, records, duplicates, learners: [...learners].map(learner => {
    const entries = records.filter(r => r.learner === learner);
    const floors = [...new Set(entries.filter(r => r.flags.length === 0).map(r => r.floor))].sort();
    return { learner, floors, complete: [1, 2, 3].every(n => floors.includes(n)) && entries.every(r => !r.flags.length) };
  }) };
  return report;
}
if (require.main === module) {
  let identity;
  try {
    if (process.argv.length !== 3) throw new Error('Usage: node server/verify-codes.js <codes.csv>');
    const cfg = config();
    const source = readFileSync(process.argv[2], 'utf8');
    identity = new DatabaseSync(`${cfg.dbPath}.identity.sqlite`, { readOnly: true });
    const report = verifyCodes(source, identity, cfg.pilot, cfg.dataset);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    process.exitCode = report.learners.length && report.learners.every(l => l.complete) ? 0 : 1;
  } catch (error) {
    // Never dump input rows or a database error containing learner data.
    process.stderr.write('Code verification could not run. Check the CSV headers, quoting, and DB_PATH.\n');
    process.exitCode = 2;
  } finally { identity?.close(); }
}
module.exports = { parseCsv, verifyCodes };

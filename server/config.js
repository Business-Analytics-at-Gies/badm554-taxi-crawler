const { resolve, join } = require('node:path');
const { readFileSync } = require('node:fs');

const ROOT = resolve(__dirname, '..');
function config(env = process.env) {
  const number = (key, fallback, integer = false) => {
    const value = Number(env[key] ?? fallback);
    if (!Number.isFinite(value) || value < 0 || (integer && !Number.isInteger(value))) throw new Error(`Invalid ${key}`);
    return value;
  };
  const date = (key, fallback) => {
    const value = env[key] || fallback;
    if (!Number.isFinite(Date.parse(value))) throw new Error(`Invalid ${key}`);
    return new Date(value).toISOString();
  };
  const authMode = env.AUTH_MODE || 'entra';
  if (!['entra', 'join', 'dev'].includes(authMode)) throw new Error('Invalid AUTH_MODE');
  if (authMode === 'dev' && env.WEBSITE_SITE_NAME) throw new Error('Dev authentication is local only');
  return {
    root: ROOT, authMode, fake: env.FAKE_MODEL === '1', tutorOff: env.TUTOR_OFF === '1',
    closesAt: date('TUTOR_CLOSES_AT', '2026-10-17T23:30:00Z'),
    receiptsCloseAt: date('RECEIPTS_CLOSE_AT', '2026-10-18T00:00:00Z'),
    budget: number('BUDGET_TOTAL_USD', 140), daily: number('CAP_DAILY_USD', 1.5),
    questions: number('CAP_QUESTIONS', 40, true), port: number('PORT', 3000, true),
    dbPath: resolve(env.DB_PATH || '/home/data/taxi.db'),
    receiptSecret: env.RECEIPT_SECRET, joinCode: env.JOIN_CODE,
    model: env.MODEL || 'claude-sonnet-5-5', env,
    prompt: readFileSync(join(__dirname, 'prompt.md'), 'utf8'),
    tools: JSON.parse(readFileSync(join(__dirname, 'tools.json'), 'utf8')),
    pilot: 'badm554-2026-10-17', dataset: 'b3250b54337f64d9e3f2eb874bc2421d',
  };
}
function rerunConfig(base) {
  const opensAt = base.env.RERUN_OPENS_AT || '2026-10-23T05:00:00Z';
  if (!Number.isFinite(Date.parse(opensAt))) throw new Error('Invalid RERUN_OPENS_AT');
  const cfg = config({ ...base.env,
    TUTOR_CLOSES_AT: base.env.RERUN_CLOSES_AT || '2026-10-27T04:59:00Z',
    RECEIPTS_CLOSE_AT: base.env.RERUN_CLOSES_AT || '2026-10-27T04:59:00Z',
    BUDGET_TOTAL_USD: base.env.RERUN_BUDGET_TOTAL_USD ?? '50',
    DB_PATH: `${base.dbPath}.rerun.sqlite`,
  });
  return { ...cfg, identityPath: `${base.dbPath}.identity.sqlite`,
    opensAt: new Date(opensAt).toISOString(),
    earlyAccess: new Set((base.env.RERUN_EARLY_ACCESS || '').split(',').map(name => name.trim().toLowerCase()).filter(Boolean)),
    pilot: 'badm554-rerun-2026-10-23', dataset: 'rerun-v1-trip-id-2026-10-18',
    receiptPrefix: 'RERUN', receiptFloors: { 1: 'rerun-1', 2: 'rerun-2', 3: 'rerun-3' },
    prompt: readFileSync(join(__dirname, 'rerun-prompt.md'), 'utf8'),
    tools: JSON.parse(readFileSync(join(__dirname, 'rerun-tools.json'), 'utf8')),
  };
}
module.exports = { config, rerunConfig };

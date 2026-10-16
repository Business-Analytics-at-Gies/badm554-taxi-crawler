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
  if (env.FAKE_MODEL !== '1') throw new Error('Thin path supports FAKE_MODEL=1 only');
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
module.exports = { config };

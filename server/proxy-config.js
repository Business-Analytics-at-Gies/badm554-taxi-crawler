const MODEL = 'claude-sonnet-5-5';
function proxyConfig(env) {
  const number = (key, fallback, integer = false) => {
    const n = Number(env[key] ?? fallback);
    if (!Number.isFinite(n) || n < 0 || (integer && (!Number.isSafeInteger(n) || n < 1))) throw new Error(`Invalid ${key}`);
    return n;
  };
  const closesAt = new Date(env.PROXY_CLOSES_AT || '2026-11-06T06:00:00Z');
  if (!Number.isFinite(closesAt.getTime())) throw new Error('Invalid PROXY_CLOSES_AT');
  const maxTokens = number('PROXY_MAX_TOKENS', 128000, true);
  if (maxTokens > 128000) throw new Error('Invalid PROXY_MAX_TOKENS');
  const activity = env.PROXY_ACTIVITY || 'm7-sql-game-2026';
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(activity)) throw new Error('Invalid PROXY_ACTIVITY');
  return { enabled: env.PROXY_ENABLED === '1', activity, model: MODEL, closesAt: closesAt.toISOString(),
    student: number('PROXY_STUDENT_CAP_USD', 5), daily: number('PROXY_DAILY_CAP_USD', 2.5),
    total: number('PROXY_TOTAL_CAP_USD', 150), maxTokens, rpm: number('PROXY_RPM', 10, true),
    inflight: number('PROXY_MAX_INFLIGHT', 2, true), global: number('PROXY_GLOBAL_INFLIGHT', 10, true),
    timeout: number('PROXY_TIMEOUT_MS', 45000, true) };
}
module.exports = { proxyConfig, MODEL };

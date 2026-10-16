const { randomUUID } = require('node:crypto');
const { readFileSync } = require('node:fs');

// PLACEHOLDERS, NOT VERIFIED SONNET/HAIKU 5.5 LIST PRICES.
// Claude must replace these and mark confirmed:true before live integration.
// USD per million tokens, maintained only in this table.
const PRICES = {
  'claude-sonnet-5-5': { input: 3, output: 15, cacheWrite: 3.75, cacheWriteHour: 6, cacheRead: 0.3, confirmed: false },
  'claude-haiku-5-5': { input: 1, output: 5, cacheWrite: 1.25, cacheWriteHour: 2, cacheRead: 0.1, confirmed: false },
};
function costUsd(usage, price) {
  for (const key of ['input_tokens', 'output_tokens']) {
    if (!Number.isSafeInteger(usage?.[key]) || usage[key] < 0) throw new Error('Missing or invalid usage');
  }
  for (const key of ['cache_creation_input_tokens', 'cache_read_input_tokens']) {
    if (usage[key] !== undefined && (!Number.isSafeInteger(usage[key]) || usage[key] < 0)) throw new Error('Invalid cache usage');
  }
  const written = usage.cache_creation_input_tokens || 0;
  const hour = usage.cache_creation?.ephemeral_1h_input_tokens || 0;
  if (!Number.isSafeInteger(hour) || hour < 0 || hour > written) throw new Error('Invalid cache duration usage');
  const nano = usage.input_tokens * price.input * 1000 + usage.output_tokens * price.output * 1000 +
    (written - hour) * price.cacheWrite * 1000 + hour * (price.cacheWriteHour || price.cacheWrite * 1.6) * 1000 +
    (usage.cache_read_input_tokens || 0) * price.cacheRead * 1000;
  return Math.ceil(nano - 1e-7) / 1e9;
}
function inputBound(payload) {
  // Every UTF-8 byte can be a token; include 4096 for protocol/tool scaffolding.
  // No prompt caching is requested, so input price bounds this request.
  return Buffer.byteLength(JSON.stringify(payload), 'utf8') + 4096;
}
function requestPayload(config, messages) {
  const payload = { model: config.model, system: config.prompt, tools: config.tools, max_tokens: 1500, messages: structuredClone(messages) };
  while (inputBound(payload) > 30000) {
    const next = payload.messages.findIndex((m, i) => i > 0 && m.role === 'user' && typeof m.content === 'string');
    if (next < 0) throw new Error('Current question exceeds input limit');
    payload.messages.splice(0, next);
  }
  return payload;
}
async function liveResponse(config, payload, fetchImpl = fetch) {
  const key = config.env.ANTHROPIC_API_KEY || (config.env.ANTHROPIC_KEY_FILE ? readFileSync(config.env.ANTHROPIC_KEY_FILE, 'utf8').trim() : '');
  if (!key) throw new Error('Anthropic key is not configured');
  const response = await fetchImpl('https://api.anthropic.com/v1/messages', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify(payload), signal: AbortSignal.timeout(45000),
  });
  if (!response.ok) throw new Error('Model request failed');
  return response.json();
}

const SAMPLES = {
  run_sql: { sql: 'SELECT COUNT(*) AS rows FROM trips_raw' },
  lens: { sql: 'SELECT row_id, pu_location_id, do_location_id FROM trips_raw LIMIT 5', label: 'Look at these trips' },
  plant: { kind: 'duplicate', count: 1 }, unplant: { row_ids: [] }, undo_experiments: {},
  navigate: { room: 'floor1' }, highlight: { target: 'console', note: 'Try a row count here.' },
  game: { action: 'open', floor: 1 }, show_code: { file: 'floor1-reference' }, look: {},
};
function fakeResponse(messages) {
  const last = messages.at(-1);
  const result = Array.isArray(last.content) && last.content.some(b => b.type === 'tool_result');
  const text = typeof last.content === 'string' ? last.content : '';
  const name = text.match(/tool:([a-z_]+)/)?.[1];
  return {
    content: !result && Object.hasOwn(SAMPLES, name || '')
      ? [{ type: 'tool_use', id: `tool_${randomUUID()}`, name, input: SAMPLES[name] }]
      : [{ type: 'text', text: result ? 'The map has updated. What do you notice about those rows?' : 'Start with the row count. What do you expect it to show?' }],
    usage: { input_tokens: 100, output_tokens: 30, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
  };
}
module.exports = { fakeResponse, PRICES, costUsd, inputBound, requestPayload, liveResponse };

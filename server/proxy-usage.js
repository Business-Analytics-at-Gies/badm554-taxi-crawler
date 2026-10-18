const { costUsd } = require('./model');
class UnpricedUsage extends Error { constructor() { super('Unrecognized proxy usage'); } }
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const fail = () => { throw new UnpricedUsage(); };
const tokenFields = ['input_tokens', 'output_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens'];
const neutral = ['cache_creation', 'iterations', 'output_tokens_details', 'server_tool_use', 'inference_geo', 'service_tier', 'speed', 'fallback_credit'];
const integer = value => Number.isSafeInteger(value) && value >= 0;
function knownKeys(value, allowed) { if (!object(value) || Object.keys(value).some(key => !allowed.includes(key))) fail(); }
function fields(usage, model, iteration = false) {
  const typed = iteration && object(usage) ? usage.type : undefined;
  const allowed = iteration ? [...tokenFields, 'cache_creation', 'type', ...(typed === 'compaction' ? [] : ['model'])] : [...tokenFields, ...neutral];
  knownKeys(usage, allowed);
  if (iteration && (!['message', 'compaction', 'advisor_message', 'fallback_message'].includes(typed) ||
    (['advisor_message', 'fallback_message'].includes(typed) ? usage.model !== model : usage.model != null && usage.model !== model))) fail();
  if (usage.cache_creation != null) {
    knownKeys(usage.cache_creation, ['ephemeral_5m_input_tokens', 'ephemeral_1h_input_tokens']);
    if (Object.values(usage.cache_creation).some(v => !integer(v))) throw new Error('Invalid cache usage');
  }
  if (usage.output_tokens_details != null) {
    knownKeys(usage.output_tokens_details, ['thinking_tokens']);
    if (!integer(usage.output_tokens_details.thinking_tokens)) throw new Error('Invalid thinking usage');
  }
  if (usage.server_tool_use != null) {
    knownKeys(usage.server_tool_use, ['web_search_requests', 'web_fetch_requests']);
    if (Object.values(usage.server_tool_use).some(v => v !== 0)) fail();
  }
  if (usage.inference_geo != null && usage.inference_geo !== 'global') fail();
  if (usage.service_tier != null && usage.service_tier !== 'standard') fail();
  if (usage.speed != null && usage.speed !== 'standard') fail();
  if (usage.fallback_credit != null) fail();
  if (usage.iterations != null) {
    if (iteration || !Array.isArray(usage.iterations)) fail();
    for (const item of usage.iterations) fields(item, model, true);
  }
}
function normalize(value) {
  const result = {};
  for (const key of tokenFields) {
    const n = value[key] == null && key.startsWith('cache_') ? 0 : value[key];
    if (!integer(n)) throw new Error('Invalid token usage');
    result[key] = n;
  }
  const hour = value.cache_creation?.ephemeral_1h_input_tokens || 0;
  const five = value.cache_creation?.ephemeral_5m_input_tokens ?? result.cache_creation_input_tokens - hour;
  if (!integer(hour) || !integer(five) || hour + five !== result.cache_creation_input_tokens) throw new Error('Invalid cache duration usage');
  result.cache_creation = { ephemeral_1h_input_tokens: hour, ephemeral_5m_input_tokens: five };
  return result;
}
function bill(usage, price, model) {
  fields(usage, model);
  const top = normalize(usage);
  const entries = usage.iterations;
  let totals = top;
  if (entries?.length) {
    totals = normalize({ input_tokens: 0, output_tokens: 0 });
    for (const entry of entries) {
      const next = normalize(entry);
      for (const key of tokenFields) {
        totals[key] += next[key]; if (!integer(totals[key])) throw new Error('Invalid token total');
      }
      for (const key of ['ephemeral_5m_input_tokens', 'ephemeral_1h_input_tokens']) totals.cache_creation[key] += next.cache_creation[key];
    }
    // Iterations are authoritative, not additive to their ordinary top-level aggregate.
    // A partial list must never make a larger top-level bill disappear.
    if (tokenFields.some(key => totals[key] < top[key])) fail();
  }
  const usd = costUsd(totals, price);
  if (!Number.isSafeInteger(Math.round(usd * 1e9))) throw new Error('Invalid usage cost');
  return { usage: totals, usd };
}
module.exports = { UnpricedUsage, fields, bill };

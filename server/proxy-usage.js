const { costUsd } = require('./model');
class UnpricedUsage extends Error { constructor() { super('Unrecognized proxy usage'); } }
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const fail = () => { throw new UnpricedUsage(); };
const tokenFields = ['input_tokens', 'output_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens'];
const neutral = ['cache_creation', 'iterations', 'output_tokens_details', 'server_tool_use', 'inference_geo', 'service_tier', 'speed', 'fallback_credit'];
const integer = value => Number.isSafeInteger(value) && value >= 0;
const durations = ['ephemeral_5m_input_tokens', 'ephemeral_1h_input_tokens'];
function knownKeys(value, allowed) { if (!object(value) || Object.keys(value).some(key => !allowed.includes(key))) fail(); }
function fields(usage, model, iteration = false, partial = false) {
  const typed = iteration && object(usage) ? usage.type : undefined;
  const allowed = iteration ? [...tokenFields, 'cache_creation', 'type', ...(typed === 'compaction' ? [] : ['model'])] : [...tokenFields, ...neutral];
  knownKeys(usage, allowed);
  if (partial && !Object.hasOwn(usage, 'output_tokens')) fail();
  // Updates may omit counters, but every supplied value must be usable before merging.
  for (const key of tokenFields) if (Object.hasOwn(usage, key) &&
    !((key.startsWith('cache_') || partial && key === 'input_tokens') && usage[key] === null) && !integer(usage[key])) fail();
  if (iteration && (!['message', 'compaction', 'advisor_message', 'fallback_message'].includes(typed) ||
    (['advisor_message', 'fallback_message'].includes(typed) ? usage.model !== model : usage.model != null && usage.model !== model))) fail();
  if (usage.cache_creation != null) {
    knownKeys(usage.cache_creation, durations);
    if (durations.some(key => !integer(usage.cache_creation[key]))) fail();
    const sum = durations.reduce((n, key) => n + usage.cache_creation[key], 0);
    if (!integer(sum) || Object.hasOwn(usage, 'cache_creation_input_tokens') && sum !== (usage.cache_creation_input_tokens ?? 0)) fail();
  }
  if (usage.output_tokens_details != null) {
    knownKeys(usage.output_tokens_details, ['thinking_tokens']);
    const thinking = usage.output_tokens_details.thinking_tokens;
    if (!integer(thinking) || Object.hasOwn(usage, 'output_tokens') && thinking > usage.output_tokens) fail();
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
    if (usage.iterations.length) {
      // Compaction is billed separately; all ordinary counters must agree with the
      // non-compaction aggregate, including the distinct cache-duration prices.
      const ordinary = sum(usage.iterations.filter(item => item.type !== 'compaction'));
      for (const key of tokenFields) if (Object.hasOwn(usage, key) && !(partial && usage[key] === null) && (usage[key] ?? 0) !== ordinary[key]) fail();
      if (usage.cache_creation != null || Object.hasOwn(usage, 'cache_creation_input_tokens') && !(partial && usage.cache_creation_input_tokens === null)) {
        const cache = cacheCounts(usage);
        if (durations.some(key => cache[key] !== ordinary.cache_creation[key])) fail();
      }
    }
  }
  if (!partial || iteration) normalize(usage); // Only message deltas are partial records.
}
function cacheCounts(value) {
  const written = value.cache_creation_input_tokens ?? 0;
  const hour = value.cache_creation?.ephemeral_1h_input_tokens ?? 0;
  const five = value.cache_creation?.ephemeral_5m_input_tokens ?? written - hour;
  if (!integer(hour) || !integer(five) || !integer(hour + five) || hour + five !== written) fail();
  return { ephemeral_1h_input_tokens: hour, ephemeral_5m_input_tokens: five };
}
function normalize(value) {
  const result = {};
  for (const key of tokenFields) {
    const n = value[key] == null && key.startsWith('cache_') ? 0 : value[key];
    if (!integer(n)) fail();
    result[key] = n;
  }
  result.cache_creation = cacheCounts(value);
  return result;
}
function sum(entries) {
  const totals = normalize({ input_tokens: 0, output_tokens: 0 });
  for (const entry of entries) {
    const next = normalize(entry);
    for (const key of tokenFields) {
      totals[key] += next[key]; if (!integer(totals[key])) fail();
    }
    for (const key of durations) {
      totals.cache_creation[key] += next.cache_creation[key];
      if (!integer(totals.cache_creation[key])) fail();
    }
  }
  return totals;
}
function progress(previous, current) {
  const compare = (before, after) => {
    before = normalize(before); after = normalize(after);
    if (tokenFields.some(key => after[key] < before[key]) ||
      durations.some(key => after.cache_creation[key] < before.cache_creation[key])) fail();
  };
  compare(previous, current);
  const before = previous.iterations || [], after = current.iterations || [];
  if (after.length < before.length) fail();
  for (let i = 0; i < before.length; i++) {
    if (before[i].type !== after[i].type) fail();
    compare(before[i], after[i]);
  }
}
function bill(usage, price, model) {
  fields(usage, model);
  const top = normalize(usage);
  const entries = usage.iterations;
  let totals = top;
  if (entries?.length) {
    totals = sum(entries);
    // Also compare omitted ordinary counters using their normalized zero/default values.
    const ordinary = sum(entries.filter(entry => entry.type !== 'compaction'));
    if (tokenFields.some(key => ordinary[key] !== top[key]) ||
      durations.some(key => ordinary.cache_creation[key] !== top.cache_creation[key])) fail();
  }
  const usd = costUsd(totals, price);
  if (!Number.isSafeInteger(Math.round(usd * 1e9))) fail();
  return { usage: totals, usd };
}
module.exports = { UnpricedUsage, fields, bill, progress };

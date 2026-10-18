const { refuse } = require('./errors');
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const unsupported = () => refuse(400, 'unsupported_request', 'This request uses an option that is not enabled for the course API.');
const valueType = value => value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
const field = (path, key) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(key) ? `${path}.${key}` : `${path}[${JSON.stringify(key)}]`;
function fail(reject, path, value, rule) {
  reject(path, valueType(value), rule); // No value is ever passed to a diagnostic consumer.
  unsupported(); // A diagnostic callback cannot turn a refusal into acceptance.
}
const COMMON = ['model', 'messages', 'system', 'tools', 'tool_choice', 'thinking', 'cache_control', 'output_config', 'context_management'];
const COUNT_FIELDS = new Set(COMMON);
const MESSAGE_FIELDS = new Set([...COMMON, 'max_tokens', 'stream', 'stop_sequences', 'temperature', 'top_p', 'top_k', 'metadata']);
// Exact reviewed capability identifiers; unknown future flags must receive a new pricing review.
const BETAS = new Set(['claude-code-20250219', 'prompt-caching-2024-07-31', 'token-counting-2024-11-01',
  'interleaved-thinking-2025-05-14', 'extended-cache-ttl-2025-04-11',
  'context-management-2025-06-27', 'structured-outputs-2025-11-13',
  'structured-outputs-2025-12-15', 'fine-grained-tool-streaming-2025-05-14', 'effort-2025-11-24']);
function keys(value, allowed, path, reject) {
  if (!object(value)) fail(reject, path, value, 'object');
  const unknown = Object.keys(value).find(key => !allowed.includes(key));
  if (unknown !== undefined) fail(reject, field(path, unknown), value[unknown], 'allowed_keys');
}
function cache(value, path, reject) {
  if (value == null) return;
  keys(value, ['type', 'ttl'], path, reject);
  if (value.type !== 'ephemeral') fail(reject, field(path, 'type'), value.type, 'cache_type');
  if (value.ttl !== undefined && !['5m', '1h'].includes(value.ttl)) fail(reject, field(path, 'ttl'), value.ttl, 'cache_ttl');
}
function context(value, path, reject) {
  keys(value, ['edits'], path, reject);
  if (!Array.isArray(value.edits)) fail(reject, field(path, 'edits'), value.edits, 'context_edits_array');
  for (const [index, edit] of value.edits.entries()) {
    const at = `${path}.edits[${index}]`;
    if (!object(edit)) fail(reject, at, edit, 'object');
    if (edit.type === 'clear_tool_uses_20250919') {
      keys(edit, ['type', 'trigger', 'keep', 'clear_at_least', 'exclude_tools', 'clear_tool_inputs'], at, reject);
    } else if (edit.type === 'clear_thinking_20251015') keys(edit, ['type', 'keep'], at, reject);
    else fail(reject, `${at}.type`, edit.type, 'context_edit_type'); // Other strategies may add billed iterations.
    for (const name of ['trigger', 'keep', 'clear_at_least']) {
      const setting = edit[name];
      if (setting === undefined || name === 'keep' && setting === 'all' && edit.type === 'clear_thinking_20251015') continue;
      keys(setting, ['type', 'value'], field(at, name), reject);
      const unit = name !== 'keep' ? 'input_tokens' : edit.type === 'clear_thinking_20251015' ? 'thinking_turns' : 'tool_uses';
      if (setting.type !== unit) fail(reject, `${at}.${name}.type`, setting.type, 'context_unit');
      if (!Number.isSafeInteger(setting.value) || setting.value < 1) fail(reject, `${at}.${name}.value`, setting.value, 'positive_integer');
    }
    if (edit.exclude_tools !== undefined) {
      if (!Array.isArray(edit.exclude_tools)) fail(reject, `${at}.exclude_tools`, edit.exclude_tools, 'string_array');
      const bad = edit.exclude_tools.findIndex(v => typeof v !== 'string');
      if (bad >= 0) fail(reject, `${at}.exclude_tools[${bad}]`, edit.exclude_tools[bad], 'string');
    }
    if (edit.clear_tool_inputs !== undefined && typeof edit.clear_tool_inputs !== 'boolean') fail(reject, `${at}.clear_tool_inputs`, edit.clear_tool_inputs, 'boolean');
  }
}
function options(body, countOnly, cfg, reject = unsupported) {
  const allowed = countOnly ? COUNT_FIELDS : MESSAGE_FIELDS;
  keys(body, [...allowed], '$', reject);
  cache(body.cache_control, '$.cache_control', reject);
  if (body.context_management !== undefined) context(body.context_management, '$.context_management', reject);
  if (body.output_config !== undefined) {
    keys(body.output_config, ['effort', 'format'], '$.output_config', reject);
    if (body.output_config.effort !== undefined && !['low', 'medium', 'high', 'xhigh', 'max'].includes(body.output_config.effort)) fail(reject, '$.output_config.effort', body.output_config.effort, 'output_effort');
    if (body.output_config.format !== undefined) {
      keys(body.output_config.format, ['type', 'schema'], '$.output_config.format', reject);
      if (body.output_config.format.type !== 'json_schema') fail(reject, '$.output_config.format.type', body.output_config.format.type, 'json_schema_type');
      if (!object(body.output_config.format.schema)) fail(reject, '$.output_config.format.schema', body.output_config.format.schema, 'json_schema_object');
    }
  }
  if (body.thinking !== undefined) {
    keys(body.thinking, ['type', 'budget_tokens', 'display'], '$.thinking', reject);
    if (!['adaptive', 'enabled', 'disabled'].includes(body.thinking.type)) fail(reject, '$.thinking.type', body.thinking.type, 'thinking_type');
    if (body.thinking.budget_tokens !== undefined && (body.thinking.type !== 'enabled' || !Number.isSafeInteger(body.thinking.budget_tokens) || body.thinking.budget_tokens < 1024 || body.thinking.budget_tokens > (body.max_tokens || cfg.maxTokens))) fail(reject, '$.thinking.budget_tokens', body.thinking.budget_tokens, 'thinking_budget');
    if (body.thinking.display !== undefined && !['summarized', 'omitted'].includes(body.thinking.display)) fail(reject, '$.thinking.display', body.thinking.display, 'thinking_display');
  }
  if (body.metadata !== undefined) {
    keys(body.metadata, ['user_id'], '$.metadata', reject);
    if (body.metadata.user_id !== undefined && typeof body.metadata.user_id !== 'string') fail(reject, '$.metadata.user_id', body.metadata.user_id, 'metadata_user_id_string');
  }
  if (Array.isArray(body.messages)) for (const [index, message] of body.messages.entries()) {
    const at = `$.messages[${index}]`;
    keys(message, ['role', 'content'], at, reject);
    if (!['user', 'assistant'].includes(message.role)) fail(reject, `${at}.role`, message.role, 'message_role');
  }
}
function betaHeader(req, reject = unsupported) {
  if (req.headers['anthropic-version'] !== undefined && req.headers['anthropic-version'] !== '2023-06-01') fail(reject, field('$.headers', 'anthropic-version'), req.headers['anthropic-version'], 'api_version');
  const value = req.headers['anthropic-beta'];
  if (value === undefined) return undefined;
  if (typeof value !== 'string') fail(reject, field('$.headers', 'anthropic-beta'), value, 'beta_string');
  const values = value.split(',').map(v => v.trim());
  if (!values.length || values.some(v => !BETAS.has(v))) fail(reject, field('$.headers', 'anthropic-beta'), value, 'beta_allowed_values');
  if (new Set(values).size !== values.length) fail(reject, field('$.headers', 'anthropic-beta'), value, 'beta_unique_values');
  return value;
}
// Explicit internal entry points for a local test harness. No HTTP route or logging
// consumes these results; production calls the same validators with the fixed refusal.
function diagnose(run) {
  const stop = Symbol('policy diagnostic');
  let reason = null;
  try { run((path, type, rule) => { reason = { path, type, rule }; throw stop; }); }
  catch (error) { if (error !== stop) throw error; }
  return reason;
}
const diagnoseOptions = (body, countOnly, cfg) => diagnose(reject => options(body, countOnly, cfg, reject));
const diagnoseBetaHeader = req => diagnose(reject => betaHeader(req, reject));
module.exports = { options, betaHeader, COUNT_FIELDS, BETAS, diagnoseOptions, diagnoseBetaHeader };

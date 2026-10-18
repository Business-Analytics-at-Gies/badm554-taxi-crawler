const { refuse } = require('./errors');
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const unsupported = () => refuse(400, 'unsupported_request', 'This request uses an option that is not enabled for the course API.');
const COMMON = ['model', 'messages', 'system', 'tools', 'tool_choice', 'thinking', 'cache_control', 'output_config', 'context_management'];
const COUNT_FIELDS = new Set(COMMON);
const MESSAGE_FIELDS = new Set([...COMMON, 'max_tokens', 'stream', 'stop_sequences', 'temperature', 'top_p', 'top_k', 'metadata']);
// Exact reviewed capability identifiers; unknown future flags must receive a new pricing review.
const BETAS = new Set(['prompt-caching-2024-07-31', 'token-counting-2024-11-01',
  'interleaved-thinking-2025-05-14', 'extended-cache-ttl-2025-04-11',
  'context-management-2025-06-27', 'structured-outputs-2025-11-13',
  'structured-outputs-2025-12-15', 'fine-grained-tool-streaming-2025-05-14', 'effort-2025-11-24']);
function keys(value, allowed) {
  if (!object(value) || Object.keys(value).some(key => !allowed.includes(key))) unsupported();
}
function cache(value) {
  if (value == null) return;
  keys(value, ['type', 'ttl']);
  if (value.type !== 'ephemeral' || value.ttl !== undefined && !['5m', '1h'].includes(value.ttl)) unsupported();
}
function context(value) {
  keys(value, ['edits']);
  if (!Array.isArray(value.edits)) unsupported();
  for (const edit of value.edits) {
    if (!object(edit)) unsupported();
    if (edit.type === 'clear_tool_uses_20250919') {
      keys(edit, ['type', 'trigger', 'keep', 'clear_at_least', 'exclude_tools', 'clear_tool_inputs']);
    } else if (edit.type === 'clear_thinking_20251015') keys(edit, ['type', 'keep']);
    else unsupported(); // Compaction/other editing strategies may add billed iterations.
    for (const name of ['trigger', 'keep', 'clear_at_least']) {
      const setting = edit[name];
      if (setting === undefined || name === 'keep' && setting === 'all' && edit.type === 'clear_thinking_20251015') continue;
      keys(setting, ['type', 'value']);
      const unit = name !== 'keep' ? 'input_tokens' : edit.type === 'clear_thinking_20251015' ? 'thinking_turns' : 'tool_uses';
      if (setting.type !== unit || !Number.isSafeInteger(setting.value) || setting.value < 1) unsupported();
    }
    if (edit.exclude_tools !== undefined && (!Array.isArray(edit.exclude_tools) || edit.exclude_tools.some(v => typeof v !== 'string'))) unsupported();
    if (edit.clear_tool_inputs !== undefined && typeof edit.clear_tool_inputs !== 'boolean') unsupported();
  }
}
function options(body, countOnly, cfg) {
  const allowed = countOnly ? COUNT_FIELDS : MESSAGE_FIELDS;
  if (Object.keys(body).some(key => !allowed.has(key))) unsupported();
  cache(body.cache_control);
  if (body.context_management !== undefined) context(body.context_management);
  if (body.output_config !== undefined) {
    keys(body.output_config, ['effort', 'format']);
    if (body.output_config.effort !== undefined && !['low', 'medium', 'high', 'xhigh', 'max'].includes(body.output_config.effort)) unsupported();
    if (body.output_config.format !== undefined) {
      keys(body.output_config.format, ['type', 'schema']);
      if (body.output_config.format.type !== 'json_schema' || !object(body.output_config.format.schema)) unsupported();
    }
  }
  if (body.thinking !== undefined) {
    keys(body.thinking, ['type', 'budget_tokens', 'display']);
    if (!['adaptive', 'enabled', 'disabled'].includes(body.thinking.type)) unsupported();
    if (body.thinking.budget_tokens !== undefined && (body.thinking.type !== 'enabled' || !Number.isSafeInteger(body.thinking.budget_tokens) || body.thinking.budget_tokens < 1024 || body.thinking.budget_tokens > (body.max_tokens || cfg.maxTokens))) unsupported();
    if (body.thinking.display !== undefined && !['summarized', 'omitted'].includes(body.thinking.display)) unsupported();
  }
  if (body.metadata !== undefined) {
    keys(body.metadata, ['user_id']);
    if (body.metadata.user_id !== undefined && typeof body.metadata.user_id !== 'string') unsupported();
  }
  if (Array.isArray(body.messages)) for (const message of body.messages) {
    keys(message, ['role', 'content']);
    if (!['user', 'assistant'].includes(message.role)) unsupported();
  }
}
function betaHeader(req) {
  if (req.headers['anthropic-version'] !== undefined && req.headers['anthropic-version'] !== '2023-06-01') unsupported();
  const value = req.headers['anthropic-beta'];
  if (value === undefined) return undefined;
  if (typeof value !== 'string') unsupported();
  const values = value.split(',').map(v => v.trim());
  if (!values.length || values.some(v => !BETAS.has(v)) || new Set(values).size !== values.length) unsupported();
  return value;
}
module.exports = { options, betaHeader, COUNT_FIELDS, BETAS };

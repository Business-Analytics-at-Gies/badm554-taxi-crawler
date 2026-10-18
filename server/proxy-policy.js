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
const CONTENT = {
  system: ['text'], user: ['text', 'image', 'document', 'tool_result'],
  assistant: ['text', 'tool_use', 'thinking', 'redacted_thinking'],
  document: ['text', 'image'], result: ['text', 'image', 'document', 'search_result'], search: ['text'],
};
const BLOCK_KEYS = {
  text: ['type', 'text', 'cache_control', 'citations'],
  image: ['type', 'source', 'cache_control', 'transformations'],
  document: ['type', 'source', 'cache_control', 'citations', 'context', 'title'],
  tool_use: ['type', 'id', 'name', 'input', 'cache_control', 'caller'],
  tool_result: ['type', 'tool_use_id', 'content', 'is_error', 'cache_control'],
  thinking: ['type', 'thinking', 'signature'], redacted_thinking: ['type', 'data'],
  search_result: ['type', 'source', 'title', 'content', 'cache_control', 'citations'],
};
const CITATIONS = {
  char_location: ['cited_text', 'document_index', 'document_title', 'start_char_index', 'end_char_index'],
  page_location: ['cited_text', 'document_index', 'document_title', 'start_page_number', 'end_page_number'],
  content_block_location: ['cited_text', 'document_index', 'document_title', 'start_block_index', 'end_block_index'],
  search_result_location: ['cited_text', 'search_result_index', 'source', 'title', 'start_block_index', 'end_block_index'],
};
function string(value, path, reject, nullable = false) {
  if (typeof value !== 'string' && !(nullable && value === null)) fail(reject, path, value, 'string');
}
function citationConfig(value, path, reject) {
  if (value == null) return;
  keys(value, ['enabled'], path, reject);
  if (value.enabled !== undefined && typeof value.enabled !== 'boolean') fail(reject, `${path}.enabled`, value.enabled, 'boolean');
}
function citations(value, path, reject) {
  if (value == null) return;
  if (!Array.isArray(value)) fail(reject, path, value, 'citations_array');
  for (const [index, citation] of value.entries()) {
    const at = `${path}[${index}]`;
    if (!object(citation)) fail(reject, at, citation, 'object');
    if (typeof citation.type !== 'string' || !Object.hasOwn(CITATIONS, citation.type)) fail(reject, `${at}.type`, citation.type, 'citation_type');
    keys(citation, ['type', ...CITATIONS[citation.type]], at, reject);
    for (const name of CITATIONS[citation.type]) {
      const v = citation[name];
      if (name.endsWith('_index') || name.endsWith('_number')) {
        if (!Number.isSafeInteger(v) || v < 0) fail(reject, field(at, name), v, 'nonnegative_integer');
      } else string(v, field(at, name), reject, name === 'document_title' || name === 'title');
    }
  }
}
function source(value, kind, path, reject) {
  if (!object(value)) fail(reject, path, value, 'object');
  if (value.type === 'base64' || kind === 'document' && value.type === 'text') {
    keys(value, ['type', 'data', 'media_type'], path, reject);
    const media = kind === 'image' ? ['image/jpeg', 'image/png', 'image/gif', 'image/webp'] : [value.type === 'base64' ? 'application/pdf' : 'text/plain'];
    if (!media.includes(value.media_type)) fail(reject, `${path}.media_type`, value.media_type, 'source_media_type');
    string(value.data, `${path}.data`, reject);
  } else if (kind === 'document' && value.type === 'content') {
    keys(value, ['type', 'content'], path, reject);
    content(value.content, 'document', `${path}.content`, reject);
  } else fail(reject, `${path}.type`, value.type, 'source_type'); // URL/file inputs cannot be counted by this proxy's count API.
}
function content(value, role, path, reject, allowString = true) {
  if (allowString && typeof value === 'string') return;
  if (!Array.isArray(value)) fail(reject, path, value, 'content_array_or_string');
  for (const [index, block] of value.entries()) {
    const at = `${path}[${index}]`;
    if (!object(block)) fail(reject, at, block, 'object');
    if (!CONTENT[role].includes(block.type)) fail(reject, `${at}.type`, block.type, 'content_block_type');
    keys(block, role === 'system' ? ['type', 'text', 'cache_control'] : BLOCK_KEYS[block.type], at, reject);
    if (BLOCK_KEYS[block.type].includes('cache_control')) cache(block.cache_control, `${at}.cache_control`, reject);
    switch (block.type) {
      case 'text':
        string(block.text, `${at}.text`, reject);
        if (role !== 'system') citations(block.citations, `${at}.citations`, reject);
        break;
      case 'image':
        source(block.source, 'image', `${at}.source`, reject);
        if (block.transformations != null) {
          keys(block.transformations, ['oversized_image'], `${at}.transformations`, reject);
          const size = block.transformations.oversized_image;
          if (size !== undefined && !['downsize', 'error'].includes(size)) fail(reject, `${at}.transformations.oversized_image`, size, 'image_transform');
        }
        break;
      case 'document':
        source(block.source, 'document', `${at}.source`, reject);
        citationConfig(block.citations, `${at}.citations`, reject);
        for (const name of ['context', 'title']) if (block[name] !== undefined) string(block[name], field(at, name), reject, true);
        break;
      case 'tool_use':
        string(block.id, `${at}.id`, reject); string(block.name, `${at}.name`, reject);
        if (!Object.hasOwn(block, 'input')) fail(reject, `${at}.input`, undefined, 'required');
        // input is opaque client-tool data, not content blocks or proxy controls.
        if (block.caller !== undefined) {
          keys(block.caller, ['type'], `${at}.caller`, reject);
          if (block.caller.type !== 'direct') fail(reject, `${at}.caller.type`, block.caller.type, 'direct_tool_caller');
        }
        break;
      case 'tool_result':
        string(block.tool_use_id, `${at}.tool_use_id`, reject);
        if (block.is_error !== undefined && typeof block.is_error !== 'boolean') fail(reject, `${at}.is_error`, block.is_error, 'boolean');
        if (block.content !== undefined) content(block.content, 'result', `${at}.content`, reject);
        break;
      case 'thinking':
        string(block.thinking, `${at}.thinking`, reject); string(block.signature, `${at}.signature`, reject);
        break;
      case 'redacted_thinking': string(block.data, `${at}.data`, reject); break;
      case 'search_result':
        string(block.source, `${at}.source`, reject); string(block.title, `${at}.title`, reject);
        citationConfig(block.citations, `${at}.citations`, reject);
        content(block.content, 'search', `${at}.content`, reject, false);
        break;
    }
  }
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
  if (body.system !== undefined) content(body.system, 'system', '$.system', reject);
  if (Array.isArray(body.messages)) for (const [index, message] of body.messages.entries()) {
    const at = `$.messages[${index}]`;
    keys(message, ['role', 'content'], at, reject);
    if (!['user', 'assistant', 'system'].includes(message.role)) fail(reject, `${at}.role`, message.role, 'message_role');
    content(message.content, message.role, `${at}.content`, reject);
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

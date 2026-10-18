const test = require('node:test');
const assert = require('node:assert/strict');
const { options, diagnoseOptions, diagnoseBetaHeader } = require('../../server/proxy-policy');
const { outline } = require('./proxy-diagnostics');
const { fixture, message, count, ledger, capture, assertPrivate } = require('./proxy-helpers');
const cfg = { maxTokens: 128000 };
const PRIVATE = 'SYNTHETIC_DIAGNOSTIC_VALUE_MUST_NOT_APPEAR';

for (const [index, [extra, expected]] of [
  [{ unknown_option: PRIVATE }, { path: '$.unknown_option', type: 'string', rule: 'allowed_keys' }],
  [{ cache_control: { type: PRIVATE } }, { path: '$.cache_control.type', type: 'string', rule: 'cache_type' }],
  [{ thinking: { type: 'adaptive', extra: PRIVATE } }, { path: '$.thinking.extra', type: 'string', rule: 'allowed_keys' }],
  [{ thinking: { type: 'enabled', budget_tokens: PRIVATE } }, { path: '$.thinking.budget_tokens', type: 'string', rule: 'thinking_budget' }],
  [{ metadata: { user_id: { device_id: PRIVATE } } }, { path: '$.metadata.user_id', type: 'object', rule: 'metadata_user_id_string' }],
  [{ messages: [{ role: 'user', content: PRIVATE, extra: false }] }, { path: '$.messages[0].extra', type: 'boolean', rule: 'allowed_keys' }],
  [{ messages: [{ role: 'user', content: PRIVATE }, { role: PRIVATE, content: PRIVATE }] }, { path: '$.messages[1].role', type: 'string', rule: 'message_role' }],
  [{ context_management: { edits: [{ type: PRIVATE }] } }, { path: '$.context_management.edits[0].type', type: 'string', rule: 'context_edit_type' }],
  [{ output_config: { format: { type: 'json_schema', schema: PRIVATE } } }, { path: '$.output_config.format.schema', type: 'string', rule: 'json_schema_object' }],
].entries()) {
  test(`proxy diagnostics: returns only the failing path, type and rule for rejection case ${index + 1}`, () => {
    const body = message(extra);
    assert.deepEqual(diagnoseOptions(body, false, cfg), expected);
    assert.ok(!JSON.stringify(diagnoseOptions(body, false, cfg)).includes(PRIVATE));
    assert.throws(() => options(body, false, cfg), error => {
      assert.equal(error.status, 400); assert.equal(error.code, 'unsupported_request');
      assert.equal(error.message, 'This request uses an option that is not enabled for the course API.');
      assert.deepEqual(Object.keys(error).sort(), ['code', 'status']);
      return true;
    });
  });
}

test('proxy diagnostics: accepted options and beta headers have no internal refusal', () => {
  assert.equal(diagnoseOptions(message(), false, cfg), null);
  assert.equal(diagnoseOptions(count(), true, cfg), null);
  assert.equal(diagnoseBetaHeader({ headers: { 'anthropic-beta': 'claude-code-20250219' } }), null);
  assert.deepEqual(diagnoseBetaHeader({ headers: { 'anthropic-beta': PRIVATE } }),
    { path: '$.headers["anthropic-beta"]', type: 'string', rule: 'beta_allowed_values' });
});

test('proxy diagnostics: the harness outline retains keys and types, with only tool names/types as values', () => {
  const input = { metadata: { user_id: { device_id: PRIVATE } }, max_tokens: 32000, stream: true, cache_control: null,
    messages: [{ role: 'user', content: [{ type: 'text', text: PRIVATE }] }],
    tools: [{ name: 'Read', type: 'custom', description: PRIVATE, input_schema: { properties: { file_path: { type: 'string' } } } }, { name: 'Agent', description: PRIVATE }] };
  const result = outline(input);
  assert.deepEqual(result, { metadata: { user_id: { device_id: 'string' } }, max_tokens: 'number', stream: 'boolean', cache_control: 'null',
    messages: [{ role: 'string', content: [{ type: 'string', text: 'string' }] }], tools: [{ name: 'Read', type: 'custom' }, { name: 'Agent' }] });
  assert.ok(!JSON.stringify(result).includes(PRIVATE));
});

test('proxy diagnostics: tool calls and results retain only names/types, including nested tool content', () => {
  const result = outline({ messages: [{ role: 'assistant', content: [
    { type: 'tool_use', id: 'toolu_private', name: 'Read', input: { file_path: PRIVATE } },
    { type: 'server_tool_use', name: 'web_search', input: { query: PRIVATE } },
    { type: 'tool_result', tool_use_id: 'toolu_private', content: [{ type: 'text', text: PRIVATE }] },
    { type: 'tool_addition', tool: { type: 'tool_definition', definition: { name: 'Read', input_schema: { properties: { file_path: {} } } } } },
    { type: 'tool_removal', tool: { type: 'tool_reference', name: 'Read', private_option: PRIVATE } },
    { type: 'tool_reference', name: 'Read', private_option: PRIVATE },
  ] }] });
  assert.deepEqual(result, { messages: [{ role: 'string', content: [
    { type: 'tool_use', name: 'Read' }, { type: 'server_tool_use', name: 'web_search' },
    { type: 'tool_result' }, { type: 'tool_addition' }, { type: 'tool_removal' }, { type: 'tool_reference', name: 'Read' },
  ] }] });
});

test('proxy diagnostics: production HTTP refuses with its fixed message and stores/logs no reason or value', async t => {
  const f = await fixture(t), k = await f.mint(), logs = capture(t);
  const r = await f.send(k.token, message({ metadata: { user_id: { device_id: PRIVATE } } }));
  assert.equal(r.status, 400);
  assert.deepEqual(r.body, { error: 'unsupported_request', message: 'This request uses an option that is not enabled for the course API.' });
  assert.equal(f.upstream.calls.length, 0); assert.equal(ledger(f).length, 0);
  assertPrivate(f, [PRIVATE, 'metadata_user_id_string', '$.metadata.user_id', k.token], logs);
});

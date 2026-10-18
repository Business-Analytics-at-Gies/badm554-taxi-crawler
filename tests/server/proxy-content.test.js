const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture, message, count, ledger, PROMPT, ANSWER, capture, assertPrivate } = require('./proxy-helpers');
const text = { type: 'text', text: PROMPT, cache_control: { type: 'ephemeral' } };
const image = { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'synthetic-base64' } };
const document = { type: 'document', source: { type: 'content', content: [text, image] }, citations: { enabled: true }, title: 'Synthetic' };
const tool = { type: 'tool_use', id: 'toolu_synthetic', name: 'local_sql', input: { query: PROMPT } };
const result = { type: 'tool_result', tool_use_id: 'toolu_synthetic', content: [text, image, document] };
const schema = { name: 'local_sql', input_schema: { type: 'object' } };
const refusedBody = { error: 'unsupported_request', message: 'This request uses an option that is not enabled for the course API.' };

async function refused(t, role, content, extra = {}) {
  const f = await fixture(t), k = await f.mint(), logs = capture(t);
  for (const countOnly of [false, true]) {
    const body = (countOnly ? count : message)({ messages: [{ role, content }], ...extra });
    const r = await f.send(k.token, body, `/proxy/v1/messages${countOnly ? '/count_tokens' : ''}`, { 'anthropic-beta': 'claude-code-20250219' });
    assert.equal(r.status, 400);
    assert.deepEqual(r.body, refusedBody);
  }
  assert.equal(f.upstream.calls.length, 0);
  assert.equal(ledger(f).length, 0);
  assertPrivate(f, [PROMPT, ANSWER, k.token], logs);
}

for (const [name, block] of [
  ['custom definition', { type: 'tool_addition', tool: { type: 'tool_definition', definition: { name: 'new_sql_tool', input_schema: { type: 'object' } } } }],
  ['declared reference', { type: 'tool_addition', tool: { type: 'tool_reference', name: 'local_sql' } }],
  ['tool removal', { type: 'tool_removal', tool: { type: 'tool_reference', name: 'local_sql' } }],
]) {
  test(`proxy P3 content: system inline ${name} reproduction is refused on both endpoints before counting`, t =>
    refused(t, 'system', [block], { tools: [schema] }));
}

const allowed = { system: ['text'], user: ['text', 'image', 'document', 'tool_result'], assistant: ['text', 'tool_use', 'thinking', 'redacted_thinking'] };
for (const role of Object.keys(allowed)) {
  for (const type of ['text', 'image', 'document', 'tool_result', 'tool_use', 'thinking', 'redacted_thinking',
    'tool_addition', 'tool_removal', 'server_tool_use', 'web_search_tool_result', 'container_upload', 'compaction', 'future_unknown']) {
    if (!allowed[role].includes(type)) test(`proxy P3 content: ${role} refuses block type ${type}`, t => refused(t, role, [{ type }]));
  }
}

const permitted = [
  ['system', PROMPT], ['system', [text]], ['user', PROMPT], ['assistant', PROMPT],
  ['user', [text, image, document, result]],
  ['user', [{ type: 'document', source: { type: 'text', media_type: 'text/plain', data: PROMPT }, context: PROMPT }]],
  ['user', [{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: 'synthetic-base64' } }]],
  ['user', [{ ...result, content: [{ type: 'search_result', source: 'synthetic', title: 'Synthetic', content: [text], citations: { enabled: true } }] }]],
  ['user', [{ ...image, transformations: { oversized_image: 'error' } }]],
  ['assistant', [text, { ...tool, caller: { type: 'direct' } }, { type: 'thinking', thinking: PROMPT, signature: 'synthetic' }, { type: 'redacted_thinking', data: 'synthetic' }]],
  ['assistant', [{ type: 'text', text: PROMPT, citations: [{ type: 'char_location', cited_text: PROMPT, document_index: 0, document_title: null, start_char_index: 0, end_char_index: 1 }] }]],
];
for (const [index, [role, content]] of permitted.entries()) {
  test(`proxy P3 content: permitted role content case ${index + 1} passes unchanged through counting and generation`, async t => {
    const f = await fixture(t), k = await f.mint(), logs = capture(t);
    const body = message({ system: [text], messages: [{ role, content }] });
    assert.equal((await f.send(k.token, body)).status, 200);
    assert.equal(f.upstream.calls.length, 2);
    for (const call of f.upstream.calls) assert.deepEqual(call.body.messages, body.messages);
    assert.deepEqual(f.upstream.messages[0].body, body);
    assert.equal(ledger(f)[0].status, 'settled');
    assertPrivate(f, [PROMPT, ANSWER, k.token], logs);
  });
}

for (const [index, [role, block]] of [
  ['system', text], ['user', text], ['user', image], ['user', document], ['user', result],
  ['assistant', tool], ['assistant', { type: 'thinking', thinking: PROMPT, signature: 'synthetic' }],
  ['assistant', { type: 'redacted_thinking', data: 'synthetic' }],
].entries()) {
  test(`proxy P3 content: unknown key on permitted block case ${index + 1} is refused`, t => refused(t, role, [{ ...block, unknown_control: { model: 'claude-haiku-5-5' } }]));
}

for (const [index, content] of [
  [null], [1], [{ type: 'text', text: 1 }], [{ type: 'text', text: PROMPT, cache_control: { type: 'ephemeral', unknown_control: true } }],
  [{ ...image, source: { ...image.source, unknown_control: true } }],
  [{ ...image, source: { type: 'url', url: 'https://example.invalid/private' } }],
  [{ ...image, transformations: { oversized_image: 'error', unknown_control: true } }],
  [{ ...document, citations: { enabled: true, unknown_control: true } }],
  [{ ...document, source: { type: 'content', content: [{ type: 'tool_addition' }] } }],
  [{ ...document, source: { type: 'content', content: [{ ...text, unknown_control: true }] } }],
  [{ ...result, content: [{ type: 'tool_use', ...tool }] }],
  [{ ...result, content: [{ type: 'tool_addition' }] }],
  [{ ...result, content: [{ type: 'tool_removal' }] }],
  [{ ...result, content: [{ type: 'future_unknown' }] }],
  [{ ...result, content: [{ ...text, unknown_control: true }] }],
  [{ ...result, content: [{ type: 'search_result', source: 'synthetic', title: 'Synthetic', content: [{ type: 'tool_removal' }] }] }],
  [{ type: 'text', text: PROMPT, citations: [{ type: 'future_unknown' }] }],
  [{ type: 'text', text: PROMPT, citations: [{ type: 'char_location', unknown_control: true }] }],
].entries()) {
  test(`proxy P3 content: nested or malformed user content case ${index + 1} is refused before counting`, t => refused(t, 'user', content));
}

test('proxy P3 content: top-level system also refuses inline tool changes', t => refused(t, 'user', PROMPT, { system: [{ type: 'tool_addition' }] }));
test('proxy P3 content: system text blocks refuse citations and every extra key', t => refused(t, 'system', [{ ...text, citations: [] }]));
test('proxy P3 content: assistant tool caller cannot enable a server tool', t => refused(t, 'assistant', [{ ...tool, caller: { type: 'code_execution_20260120', tool_id: 'synthetic' } }]));
test('proxy P3 content: assistant tool caller refuses unknown keys', t => refused(t, 'assistant', [{ ...tool, caller: { type: 'direct', extra: true } }]));
test('proxy P3 content: opaque client tool arguments remain data', async t => {
  const f = await fixture(t), k = await f.mint();
  const body = message({ messages: [{ role: 'assistant', content: [{ ...tool, input: { type: 'tool_addition', model: 'claude-haiku-5-5', nested: { future_unknown: PROMPT } } }] }] });
  assert.equal((await f.send(k.token, body)).status, 200);
  assert.deepEqual(f.upstream.messages[0].body, body);
});

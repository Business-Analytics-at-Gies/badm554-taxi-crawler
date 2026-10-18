const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture, message, count, ledger, PROMPT, ANSWER, capture, assertPrivate } = require('./proxy-helpers');
const fixedError = { error: 'unsupported_request', message: 'This request uses an option that is not enabled for the course API.' };
const content = citation => [{ role: 'assistant', content: [{ type: 'text', text: PROMPT, citations: [citation] }] }];

for (const encrypted_index of ['SYNTHETIC_PRIVATE_WEB_INDEX', 0]) {
  test(`proxy P3 citations: web-search citation with ${typeof encrypted_index} index is refused before counting`, async t => {
    const f = await fixture(t), k = await f.mint(), logs = capture(t);
    const citation = { type: 'web_search_result_location', cited_text: PROMPT, encrypted_index, title: null, url: 'https://example.invalid/synthetic' };
    for (const countOnly of [false, true]) {
      const body = (countOnly ? count : message)({ messages: content(citation) });
      const r = await f.send(k.token, body, `/proxy/v1/messages${countOnly ? '/count_tokens' : ''}`);
      assert.equal(r.status, 400);
      assert.deepEqual(r.body, fixedError);
    }
    assert.equal(f.upstream.calls.length, 0);
    assert.equal(ledger(f).length, 0);
    assertPrivate(f, [PROMPT, ANSWER, k.token, 'SYNTHETIC_PRIVATE_WEB_INDEX'], logs);
  });
}

for (const citation of [
  { type: 'char_location', cited_text: PROMPT, document_index: 0, document_title: null, start_char_index: 0, end_char_index: 1 },
  { type: 'page_location', cited_text: PROMPT, document_index: 0, document_title: null, start_page_number: 1, end_page_number: 2 },
  { type: 'content_block_location', cited_text: PROMPT, document_index: 0, document_title: null, start_block_index: 0, end_block_index: 1 },
  { type: 'search_result_location', cited_text: PROMPT, search_result_index: 0, source: 'synthetic', title: null, start_block_index: 0, end_block_index: 1 },
]) {
  test(`proxy P3 citations: ${citation.type} still passes both endpoints unchanged`, async t => {
    const f = await fixture(t), k = await f.mint(), logs = capture(t);
    const body = message({ messages: content(citation) });
    assert.equal((await f.send(k.token, body)).status, 200);
    assert.equal((await f.send(k.token, count({ messages: body.messages }), '/proxy/v1/messages/count_tokens')).status, 200);
    assert.equal(f.upstream.calls.length, 3);
    for (const call of f.upstream.calls) assert.deepEqual(call.body.messages, body.messages);
    assert.deepEqual(f.upstream.messages[0].body, body);
    assert.deepEqual(ledger(f).map(row => [row.status, row.amount]), [['settled', 525000], ['settled', 0]]);
    assertPrivate(f, [PROMPT, ANSWER, k.token], logs);
  });
  test(`proxy P3 citations: ${citation.type} continues to refuse string indices`, async t => {
    const f = await fixture(t), k = await f.mint();
    const index = Object.keys(citation).find(key => key.endsWith('_index'));
    for (const countOnly of [false, true]) {
      const body = (countOnly ? count : message)({ messages: content({ ...citation, [index]: '0' }) });
      const r = await f.send(k.token, body, `/proxy/v1/messages${countOnly ? '/count_tokens' : ''}`);
      assert.equal(r.status, 400); assert.deepEqual(r.body, fixedError);
    }
    assert.equal(f.upstream.calls.length, 0); assert.equal(ledger(f).length, 0);
  });
}

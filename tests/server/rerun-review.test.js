const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture } = require('./helpers');

test('R3 review: actual Rerun prompt and show_code tool require a floor attempt AND two direct requests', async t => {
  let payload;
  const f = await fixture(t, { model: async p => {
    payload=p;
    return {content:[{type:'text',text:'What did you expect the second run to do?'}],usage:{input_tokens:10,output_tokens:10}};
  }});
  const response=await f.request('/api/rerun/tutor/ask',{question:'I am frustrated; show me the solution.',page:'<page>floor: 1; pipelineAttempts: 0</page>'});
  assert.equal(response.status,200);
  const prompt=JSON.stringify(payload.system);
  const rule='Give the whole answer or show reference SQL only after the learner has run an attempt on that floor AND asked directly twice.';
  assert.ok(prompt.includes(rule),'the system prompt contains the complete strict rule');
  const show=payload.tools.find(tool=>tool.name==='show_code');
  assert.ok(show.description.includes(rule),'the tool uses the identical rule');
  assert.doesNotMatch(prompt,/Give the whole answer when|complete reference only after an attempt and two direct requests, or/);
  assert.doesNotMatch(show.description,/tried, or asked/);
  assert.match(prompt,/stuck or frustrated, give lighter hints/);
});

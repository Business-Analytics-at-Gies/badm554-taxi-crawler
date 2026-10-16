const { randomUUID } = require('node:crypto');
const { refuse } = require('./errors');
const { fakeResponse, liveResponse, requestPayload, inputBound, costUsd, PRICES } = require('./model');

function object(value, keys, required = keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).some(k => !keys.includes(k)) || required.some(k => !Object.hasOwn(value, k))) {
    refuse(400, 'bad_request', 'That request has unexpected or missing fields.');
  }
}
function text(value, max, allowEmpty = true) {
  if (typeof value !== 'string' || (!allowEmpty && !value.trim())) refuse(400, 'bad_request', 'Please enter a question as text.');
  if (value.length > max) refuse(400, 'too_long', 'That text is too long. Please shorten it.');
}
class Tutor {
  constructor(config, store, now, model, fetchImpl) {
    this.config = config; this.store = store; this.now = now;
    this.model = model || (config.fake ? p => fakeResponse(p.messages) : p => liveResponse(config, p, fetchImpl));
    this.busy = new Set();
    if (!PRICES[config.model] || (!config.fake && !PRICES[config.model].confirmed)) throw new Error('Confirm model prices in server/model.js before live use');
  }
  open() { return this.config.env.TUTOR_OFF !== '1' && this.now() < Date.parse(this.config.closesAt); }
  guard() {
    if (this.config.env.TUTOR_OFF === '1') refuse(403, 'tutor_off', 'The tutor is switched off. You can still play the game.');
    if (this.now() >= Date.parse(this.config.closesAt)) refuse(403, 'tutor_closed', 'The tutor has closed. You can still play the game.');
  }
  async locked(session, fn) {
    this.guard();
    if (this.busy.has(session)) refuse(409, 'busy', 'Please wait for the current answer to finish.');
    this.busy.add(session);
    try { return await fn(); } finally { this.busy.delete(session); }
  }
  history(session) {
    const state = this.store.turn(session);
    if (!this.busy.has(session) && state && !state.done && state.pending.length) {
      // The history contract is text-only. A reloaded browser cannot recover tool
      // ids from it, so finish outstanding tools as interrupted without replaying
      // their side effects or charging for a model call.
      const note = 'The previous tool turn was interrupted. You can ask a new question.';
      state.messages.push({ role: 'user', content: state.pending.map(call => ({
        type: 'tool_result', tool_use_id: call.id, is_error: true, content: 'interrupted',
      })) }, { role: 'assistant', content: [{ type: 'text', text: note }] });
      state.pending = []; state.done = true;
      this.store.transaction(() => { this.store.saveTurn(session, state); this.store.addHistory(session, 'tutor', note); });
    }
    return this.store.history(session);
  }
  async ask(session, body, quota = session) {
    object(body, ['question', 'page']);
    text(body.question, 1500, false); text(body.page, 8000);
    return this.locked(session, async () => {
      const old = this.store.turn(session);
      if (old && !old.done) refuse(409, 'busy', 'Please finish the current tutor turn first.');
      const state = {
        id: randomUUID(), messages: [...(old?.messages || []), { role: 'user', content: `${body.page}\n${body.question}` }],
        pending: [], rounds: 0, done: false, inflight: false,
      };
      return this.respond(session, quota, state, body.question);
    });
  }
  async continue(session, body, quota = session) {
    object(body, ['turn', 'results']); text(body.turn, 200, false);
    if (!Array.isArray(body.results) || body.results.length > 20) refuse(400, 'bad_turn', 'Those tool results do not match this turn.');
    for (const result of body.results) {
      object(result, ['id', 'ok', 'output']); text(result.id, 200, false); text(result.output, 8000);
      if (typeof result.ok !== 'boolean') refuse(400, 'bad_request', 'A tool result must say whether it succeeded.');
    }
    return this.locked(session, async () => {
      const state = this.store.turn(session);
      const ids = new Set(body.results.map(r => r.id));
      if (!state || state.done || state.id !== body.turn || !state.pending.length ||
          ids.size !== body.results.length || body.results.length !== state.pending.length || !state.pending.every(p => ids.has(p.id))) {
        refuse(400, 'bad_turn', 'Those tool results do not match this turn.');
      }
      state.messages.push({ role: 'user', content: body.results.map(r => ({ type: 'tool_result', tool_use_id: r.id, content: r.output, is_error: !r.ok })) });
      state.pending = [];
      return this.respond(session, quota, state);
    });
  }
  async respond(session, quota, state, question) {
    let payload;
    try { payload = requestPayload(this.config, state.messages); }
    catch { refuse(400, 'too_long', 'This tutor turn is too large. Please start with a shorter question.'); }
    const price = PRICES[this.config.model];
    const estimate = (inputBound(payload) * price.input + 1500 * price.output) / 1e6;
    const reservation = this.store.reserve(session, quota, estimate, question !== undefined);
    try {
      state.inflight = true;
      state.messages = payload.messages;
      this.store.transaction(() => {
        this.store.saveTurn(session, state);
        if (question !== undefined) this.store.addHistory(session, 'learner', question);
      });
      const response = await this.model(payload);
      this.store.settle(reservation, costUsd(response.usage, price), response.usage);
      if (!Array.isArray(response.content) || !response.content.length) throw new Error('Invalid model reply');
      const allowed = new Set(this.config.tools.map(t => t.name));
      const ids = new Set();
      for (const b of response.content) {
        if (b.type === 'text') { if (typeof b.text !== 'string') throw new Error('Invalid model text'); }
        else if (b.type === 'tool_use') {
          if (typeof b.id !== 'string' || !b.id || b.id.length > 200 || ids.has(b.id) || !allowed.has(b.name) ||
              !b.input || typeof b.input !== 'object' || Array.isArray(b.input)) throw new Error('Invalid model tool');
          ids.add(b.id);
        } else throw new Error('Unsupported model content');
      }
      const calls = response.content.filter(b => b.type === 'tool_use').map(b => ({ id: b.id, name: b.name, input: b.input }));
      if (calls.length > 20) throw new Error('Too many tool calls');
      if (calls.length && state.rounds >= 8) refuse(400, 'bad_turn', 'This question reached its tool limit. Please ask a new question.');
      const reply = response.content.filter(b => b.type === 'text').map(b => b.text).join('\n');
      state.messages.push({ role: 'assistant', content: response.content });
      state.pending = calls; state.rounds += calls.length ? 1 : 0;
      state.done = !calls.length; state.inflight = false;
      this.store.transaction(() => { this.store.addHistory(session, 'tutor', reply); this.store.saveTurn(session, state); });
      return { turn: state.id, text: reply, tool_calls: calls, done: state.done };
    } catch (error) {
      this.store.unknown(reservation);
      this.store.saveTurn(session, { ...state, inflight: false, done: true, pending: [], messages: [] });
      if (error.code === 'bad_turn') throw error;
      refuse(502, 'upstream_error', 'The tutor could not finish that answer. Please try again.');
    }
  }
}
module.exports = { Tutor, object, text };

const { randomUUID } = require('node:crypto');
const { refuse, HttpError } = require('./errors');
const { fakeResponse, liveResponse, requestPayload, inputBound, costUsd, PRICES } = require('./model');
const { validate } = require('./tool-validation');

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
      state.messages.push({ role: 'user', content: [...(state.internalResults || []), ...state.pending.map(call => ({
        type: 'tool_result', tool_use_id: call.id, is_error: true, content: 'interrupted',
      }))] }, { role: 'assistant', content: [{ type: 'text', text: note }] });
      state.pending = []; state.internalResults = []; state.done = true;
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
      const prior = old?.messages || [];
      const context = Number.isInteger(old?.discardFrom) ? prior.slice(0, old.discardFrom) : prior;
      const state = {
        id: randomUUID(), messages: [...context, { role: 'user', content: `${body.page}\n${body.question}` }],
        pending: [], internalResults: [], rounds: 0, done: false, inflight: false,
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
      state.messages.push({ role: 'user', content: [...(state.internalResults || []), ...body.results.map(r => ({ type: 'tool_result', tool_use_id: r.id, content: r.output, is_error: !r.ok }))] });
      state.pending = []; state.internalResults = [];
      return this.respond(session, quota, state);
    });
  }
  async respond(session, quota, state, question) {
    const price = PRICES[this.config.model];
    const visible = [];
    let reservation = null, started = false;
    try {
      for (;;) {
        this.guard();
        let payload;
        try { payload = requestPayload(this.config, state.messages); }
        catch { refuse(400, 'too_long', 'This tutor turn is too large. Please start with a shorter question.'); }
        // Automatic caching can charge a cache write for every input token.
        // Thinking uses the same 3000-token output allowance as visible text.
        const estimate = (inputBound(payload) * price.cacheWrite + payload.max_tokens * price.output) / 1e6;
        reservation = this.store.reserve(session, quota, estimate, question !== undefined);
        state.inflight = true;
        state.messages = payload.messages;
        this.store.transaction(() => {
          this.store.saveTurn(session, state);
          if (question !== undefined) this.store.addHistory(session, 'learner', question);
        });
        started = true;
        question = undefined;
        const response = await this.model(payload);
        this.store.settle(reservation, costUsd(response.usage, price), response.usage);
        reservation = null;
        state.inflight = false;
        if (!Array.isArray(response.content)) throw new Error('Invalid model reply');
        // Older synthetic fixtures omit stop_reason; live replies must supply it.
        const reason = response.stop_reason ?? (this.config.fake ? (response.content.some(b => b?.type === 'tool_use') ? 'tool_use' : 'end_turn') : undefined);
        if (!['refusal', 'max_tokens', 'tool_use', 'end_turn'].includes(reason)) throw new Error('Unsupported stop reason');
        const currentStart = state.messages.findLastIndex(m => m.role === 'user' && typeof m.content === 'string');
        // Keep provider blocks, including signed/redacted thinking, completely unchanged.
        state.messages.push({ role: 'assistant', content: response.content });
        if (reason === 'refusal' || reason === 'max_tokens') {
          const text = response.content.filter(b => b?.type === 'text' && typeof b.text === 'string').map(b => b.text).join('\n');
          const reply = reason === 'refusal' ? "I can't help with that one. Let's get back to the floor."
            : [text, '(I ran out of room; ask me again.)'].filter(Boolean).join('\n');
          const suppressed = response.content.filter(b => b?.type === 'tool_use');
          if (suppressed.length) {
            const ids = new Set();
            const reusable = suppressed.every(b => {
              if (typeof b.id !== 'string' || !b.id || ids.has(b.id) || !b.input || typeof b.input !== 'object' || Array.isArray(b.input)) return false;
              ids.add(b.id); return true;
            });
            if (reusable) {
              state.messages.push({ role: 'user', content: suppressed.map(b => ({ type: 'tool_result', tool_use_id: b.id,
                is_error: true, content: `Not run: model stopped with ${reason}.` })) },
              { role: 'assistant', content: [{ type: 'text', text: reply }] });
            } else {
              // Retain the raw response in storage, but do not replay a cut/unusable
              // tool block in the next question's request context.
              state.discardFrom = currentStart;
            }
          }
          state.pending = []; state.internalResults = []; state.done = true;
          this.store.transaction(() => { this.store.addHistory(session, 'tutor', reply); this.store.saveTurn(session, state); });
          visible.push(reply);
          return { turn: state.id, text: visible.join('\n'), tool_calls: [], done: true };
        }
        if (!response.content.length) throw new Error('Invalid model reply');
        const schemas = new Map(this.config.tools.map(t => [t.name, t.input_schema]));
        const ids = new Set();
        for (const b of response.content) {
          if (b?.type === 'text') { if (typeof b.text !== 'string') throw new Error('Invalid model text'); }
          else if (b?.type === 'tool_use') {
            if (typeof b.id !== 'string' || !b.id || b.id.length > 200 || ids.has(b.id) || !schemas.has(b.name)) throw new Error('Invalid model tool');
            ids.add(b.id);
          } else if (!['thinking', 'redacted_thinking'].includes(b?.type)) throw new Error('Unsupported model content');
        }
        const calls = response.content.filter(b => b.type === 'tool_use');
        if (calls.length > 20) throw new Error('Too many tool calls');
        if (calls.length && state.rounds >= 8) refuse(400, 'bad_turn', 'This question reached its tool limit. Please ask a new question.');
        if (calls.length) state.rounds++;
        state.pending = []; state.internalResults = [];
        for (const call of calls) {
          const error = validate(schemas.get(call.name), call.input);
          if (error) state.internalResults.push({ type: 'tool_result', tool_use_id: call.id, is_error: true, content: error });
          else state.pending.push({ id: call.id, name: call.name, input: call.input });
        }
        const reply = response.content.filter(b => b.type === 'text').map(b => b.text).join('\n');
        if (reply) visible.push(reply);
        state.done = calls.length === 0;
        const repair = calls.length > 0 && state.pending.length === 0;
        if (repair) {
          state.messages.push({ role: 'user', content: state.internalResults });
          state.internalResults = [];
        }
        this.store.transaction(() => { this.store.addHistory(session, 'tutor', reply); this.store.saveTurn(session, state); });
        if (!repair) return { turn: state.id, text: visible.join('\n'), tool_calls: state.pending, done: state.done };
        if (state.rounds >= 8) refuse(400, 'bad_turn', 'This question reached its tool limit. Please ask a new question.');
        // All calls failed schema validation: return errors directly to the model.
        // Each repair call gets its own reservation, shutdown check and round bound.
      }
    } catch (error) {
      if (reservation) this.store.unknown(reservation);
      if (started) this.store.saveTurn(session, { ...state, inflight: false, done: true, pending: [], internalResults: [], messages: [] });
      if (error instanceof HttpError || (!started && !reservation)) throw error;
      refuse(502, 'upstream_error', 'The tutor could not finish that answer. Please try again.');
    }
  }
}
module.exports = { Tutor, object, text };

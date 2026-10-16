const { randomUUID } = require('node:crypto');
const { refuse } = require('./errors');
const { fakeResponse } = require('./model');

class Tutor {
  constructor(config, store, now) { this.config = config; this.store = store; this.now = now; }
  async ask(session, body) {
    const state = { id: randomUUID(), messages: [{ role: 'user', content: `${body.page}\n${body.question}` }], pending: [], rounds: 0 };
    this.store.addHistory(session, 'learner', body.question);
    return this.respond(session, state);
  }
  async continue(session, body) {
    const state = this.store.turn(session);
    if (!state || state.id !== body.turn || !state.pending.length || body.results?.length !== state.pending.length ||
        !state.pending.every(p => body.results.some(r => r.id === p.id))) refuse(400, 'bad_turn', 'Those tool results do not match this turn.');
    state.messages.push({ role: 'user', content: body.results.map(r => ({ type: 'tool_result', tool_use_id: r.id, content: r.output, is_error: !r.ok })) });
    state.pending = [];
    return this.respond(session, state);
  }
  async respond(session, state) {
    const response = fakeResponse(state.messages);
    state.messages.push({ role: 'assistant', content: response.content });
    const text = response.content.filter(b => b.type === 'text').map(b => b.text).join('\n');
    state.pending = response.content.filter(b => b.type === 'tool_use').map(b => ({ id: b.id, name: b.name, input: b.input }));
    state.rounds += state.pending.length ? 1 : 0;
    this.store.addHistory(session, 'tutor', text);
    this.store.saveTurn(session, state);
    return { turn: state.id, text, tool_calls: state.pending, done: state.pending.length === 0 };
  }
}
module.exports = { Tutor };

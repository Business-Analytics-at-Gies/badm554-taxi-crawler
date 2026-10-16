const { randomUUID } = require('node:crypto');

const SAMPLES = {
  run_sql: { sql: 'SELECT COUNT(*) AS rows FROM trips_raw' },
  lens: { sql: 'SELECT row_id, pu_location_id, do_location_id FROM trips_raw LIMIT 5', label: 'Look at these trips' },
  plant: { kind: 'duplicate', count: 1 }, unplant: { row_ids: [] }, undo_experiments: {},
  navigate: { room: 'floor1' }, highlight: { target: 'console', note: 'Try a row count here.' },
  game: { action: 'open', floor: 1 }, show_code: { file: 'floor1-reference' }, look: {},
};
function fakeResponse(messages) {
  const last = messages.at(-1);
  const result = Array.isArray(last.content) && last.content.some(b => b.type === 'tool_result');
  const text = typeof last.content === 'string' ? last.content : '';
  const name = text.match(/tool:([a-z_]+)/)?.[1];
  return {
    content: !result && Object.hasOwn(SAMPLES, name || '')
      ? [{ type: 'tool_use', id: `tool_${randomUUID()}`, name, input: SAMPLES[name] }]
      : [{ type: 'text', text: result ? 'The map has updated. What do you notice about those rows?' : 'Start with the row count. What do you expect it to show?' }],
    usage: { input_tokens: 100, output_tokens: 30, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
  };
}
module.exports = { fakeResponse };

const { once } = require('node:events');

// Split only on SSE line endings, including CR/LF split over transport chunks. Byte slices
// are preserved separately from decoded field values; neither prompts nor events go to disk.
async function* lines(body) {
  let parts = [], cr = false;
  const finish = () => { const raw = Buffer.concat(parts); parts = []; return { raw, complete: true }; };
  for await (const chunk of body) {
    if (!chunk.length) continue;
    let start = 0;
    if (cr) {
      cr = false;
      if (chunk[0] === 10) { parts.push(chunk.subarray(0, 1)); start = 1; }
      yield finish();
    }
    for (let i = start; i < chunk.length; i++) {
      if (chunk[i] !== 10 && chunk[i] !== 13) continue;
      parts.push(chunk.subarray(start, i + 1));
      if (chunk[i] === 13) {
        if (i + 1 === chunk.length) { cr = true; start = i + 1; break; }
        if (chunk[i + 1] === 10) { parts.push(chunk.subarray(i + 1, i + 2)); i++; }
      }
      yield finish(); start = i + 1;
    }
    if (start < chunk.length) parts.push(chunk.subarray(start));
  }
  if (cr) yield finish();
  else if (parts.length) yield { raw: Buffer.concat(parts), complete: false };
}

async function passStream(response, res, signal, settle, inspectUsage, invalidateAccounting) {
  let rawParts = [], data = [], eventName = '', firstLine = true;
  let usage, started = false, stopped = false, invalid = false, finalDelta = false;
  let invalidAccounting = false;
  const inspect = (update, partial = false, previous) => {
    try { inspectUsage(update, partial, previous); return true; }
    catch { invalidAccounting = true; return false; }
  };
  const invalidate = () => { invalidAccounting = true; invalidateAccounting(); };
  const send = async frame => { if (!res.write(frame)) await once(res, 'drain', { signal }); };
  const dispatch = async () => {
    // An event field is authoritative even when its data is empty, invalid JSON, or absent.
    if (eventName === 'error') throw new Error('Proxy stream failed');
    if (data.length) {
      let value;
      try { value = JSON.parse(data.join('\n')); } catch { invalid = true; }
      if (value?.type === 'error') throw new Error('Proxy stream failed');
      // Accounting on an unexpected event is still accounting. Never let event type
      // or a premature stop hide a malformed counter or an extra billed attempt.
      if (value && Object.hasOwn(value, 'usage') && value.type !== 'message_delta') { inspect(value.usage); invalidate(); }
      if (value?.message && Object.hasOwn(value.message, 'usage') && value.type !== 'message_start') { inspect(value.message.usage); invalidate(); }
      if (stopped && value?.type !== 'ping') invalidate();
      if (value?.type === 'message_start') {
        if (started) { invalid = true; invalidate(); }
        started = true;
        const next = value.message?.usage;
        if (inspect(next) && !invalidAccounting) usage = { ...next };
      } else if (value?.type === 'message_delta') {
        const valid = inspect(value.usage, true);
        if (!started || !usage || !valid) invalid = true;
        else {
          finalDelta = typeof value.delta?.stop_reason === 'string' && !!value.delta.stop_reason;
          // Null optional fields in deltas mean no update, not zero billing.
          const merged = { ...usage, ...Object.fromEntries(Object.entries(value.usage).filter(([, v]) => v != null)) };
          if (inspect(merged, false, usage) && !invalidAccounting) usage = merged;
        }
      } else if (value?.type === 'message_stop') {
        if (stopped) invalid = true;
        if (started && finalDelta && !invalid && !invalidAccounting && !stopped) {
          try { settle(usage); stopped = true; } catch { invalid = true; }
        }
      }
    }
    // There is no output/event byte limit. Backpressure bounds queued transport writes.
    for (const part of rawParts) await send(part);
    rawParts = []; data = []; eventName = '';
  };
  for await (const line of lines(response.body)) {
    rawParts.push(line.raw);
    let value = line.raw.toString('utf8').replace(/\r\n$|[\r\n]$/g, '');
    if (firstLine) { value = value.replace(/^\uFEFF/, ''); firstLine = false; }
    if (line.complete && value === '') { await dispatch(); continue; }
    const colon = value.indexOf(':');
    const field = colon < 0 ? value : value.slice(0, colon);
    const content = colon < 0 ? '' : value.slice(colon + 1).replace(/^ /, '');
    if (field === 'data') data.push(content);
    else if (field === 'event') eventName = content;
  }
  // SSE dispatch requires a blank line. Discard every unfinished event at EOF, so no
  // complete or incomplete error payload can leak through a whitespace-dependent path.
}
module.exports = { passStream };

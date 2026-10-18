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

async function passStream(response, res, signal, settle, inspectUsage) {
  let rawParts = [], data = [], eventName = '', firstLine = true;
  let usage, started = false, stopped = false, invalid = false, finalDelta = false, previousOutput = 0;
  const send = async frame => { if (!res.write(frame)) await once(res, 'drain', { signal }); };
  const dispatch = async () => {
    // An event field is authoritative even when its data is empty, invalid JSON, or absent.
    if (eventName === 'error') throw new Error('Proxy stream failed');
    if (data.length) {
      let value;
      try { value = JSON.parse(data.join('\n')); } catch { invalid = true; }
      if (value?.type === 'error') throw new Error('Proxy stream failed');
      if (value?.type === 'message_start') {
        if (started) invalid = true;
        started = true;
        usage = value.message?.usage && { ...value.message.usage };
        if (usage) inspectUsage(usage);
      } else if (value?.type === 'message_delta') {
        if (!started || !usage || !value.usage) invalid = true;
        else {
          inspectUsage(value.usage);
          if (!Number.isSafeInteger(value.usage.output_tokens) || value.usage.output_tokens < previousOutput) invalid = true;
          previousOutput = value.usage.output_tokens;
          finalDelta = typeof value.delta?.stop_reason === 'string' && !!value.delta.stop_reason;
          // Null optional fields in deltas mean no update, not zero billing.
          usage = { ...usage, ...Object.fromEntries(Object.entries(value.usage).filter(([, v]) => v != null)) };
        }
      } else if (value?.type === 'message_stop') {
        if (stopped) invalid = true;
        if (started && finalDelta && !invalid && !stopped) {
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

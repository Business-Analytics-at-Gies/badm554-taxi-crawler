const { once } = require('node:events');

// Only one SSE event is retained in memory. Successful wire frames are forwarded unchanged.
async function passStream(response, res, signal, settle) {
  let pending = Buffer.alloc(0), usage, started = false, stopped = false, invalid = false, finalDelta = false, previousOutput = 0;
  const accept = async frame => {
    const lines = frame.toString('utf8').split(/\r?\n/);
    const data = lines.filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
    if (data && data !== '[DONE]') {
      let value;
      try { value = JSON.parse(data); } catch { invalid = true; }
      if (lines.some(line => /^event:\s*error\s*$/.test(line)) || value?.type === 'error') throw new Error('Proxy stream failed');
      if (value?.type === 'message_start') {
        if (started) invalid = true;
        started = true; usage = value.message?.usage && { ...value.message.usage };
      } else if (value?.type === 'message_delta') {
        if (!started || !usage || !value.usage) invalid = true;
        else {
          if (!Number.isSafeInteger(value.usage.output_tokens) || value.usage.output_tokens < previousOutput) invalid = true;
          previousOutput = value.usage.output_tokens;
          finalDelta = typeof value.delta?.stop_reason === 'string' && !!value.delta.stop_reason;
          usage = { ...usage, ...value.usage };
        }
      } else if (value?.type === 'message_stop') {
        if (stopped) invalid = true;
        if (started && finalDelta && !invalid && !stopped) {
          try { settle(usage); stopped = true; } catch { invalid = true; }
        }
      }
    }
    if (!res.write(frame)) await once(res, 'drain', { signal });
  };
  for await (const chunk of response.body) {
    pending = Buffer.concat([pending, chunk]);
    let match;
    while ((match = /\r?\n\r?\n/.exec(pending.toString('utf8')))) {
      // Indexes before the separator may contain multibyte text: derive the byte position.
      const size = Buffer.byteLength(pending.toString('utf8').slice(0, match.index + match[0].length));
      const frame = pending.subarray(0, size); pending = pending.subarray(size);
      if (frame.length > 1024 * 1024) throw new Error('Proxy stream event too large');
      await accept(frame);
    }
    if (pending.length > 1024 * 1024) throw new Error('Proxy stream event too large');
  }
  if (pending.length) {
    // Trailing incomplete frames cannot establish final usage. Preserve ordinary bytes only.
    const data = pending.toString('utf8');
    if (data.includes('"type":"error"') || data.includes('"type": "error"')) throw new Error('Proxy stream failed');
    if (!res.write(pending)) await once(res, 'drain', { signal });
  }
}
module.exports = { passStream };

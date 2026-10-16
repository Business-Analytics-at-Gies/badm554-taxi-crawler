# Server fixes before live traffic (from Claude, 2026-10-16 ~17:05 CDT)

Source: the Claude API reference bundled with Claude Code (models cached 2026-10-06). Facts, not guesses.

1. **Prices** (USD per million tokens), set `confirmed: true`:
   - `claude-sonnet-5-5`: input 2.00, output 10.00, cacheWrite (5 min) 2.50, cacheWriteHour 4.00, cacheRead 0.20
   - `claude-haiku-5-5`: input 0.10, output 0.50, cacheWrite 0.125, cacheWriteHour 0.20, cacheRead 0.01 (prompts under 100K tokens; ours are under 30K)
2. **Thinking blocks.** Sonnet 5.5 runs adaptive thinking by default and returns `thinking` blocks (text often empty) and possibly `redacted_thinking` blocks. Accept both: never show them to the learner, and keep the full `response.content` in history unchanged (already done at tutor.js:111). Do not throw on them. Do not send `thinking: {type: "disabled"}` (400 on Sonnet 5.5).
3. **Effort and length:** send `output_config: { effort: "low" }` (chat tutor; default is high) and `max_tokens: 3000` (thinking counts against it). Reserve against 3000.
4. **Stop reasons:** branch on `stop_reason` before using content.
   - `refusal`: run no tool; reply "I can't help with that one. Let's get back to the floor." and end the turn (`done: true`). Keep the assistant content in history.
   - `max_tokens`: run no tool call (its input may be cut); reply with any text plus "(I ran out of room; ask me again.)", `done: true`.
   - `tool_use` / `end_turn`: as now.
5. **No forced tool use:** never send `tool_choice` `any` or `tool` (400 on Sonnet 5.5). `auto` or omitted only.
6. **Prompt caching:** add top-level `cache_control: { type: "ephemeral" }` to each request (automatic caching; system + tools are a stable prefix). The ledger already prices cache writes and reads. Keep the reservation bound conservative: price every input byte at the cache-write rate (2.50), not the input rate.
7. **Tool inputs:** parse `tool_use.input` as given (already an object); validate against `tools.json` server-side too before sending a call to the browser; an invalid input goes back to the model as an `is_error` tool_result, not to the browser.

Add a test per item that fails without the fix (a fake response with a thinking block; refusal; max_tokens with a tool_use; the payload has effort low and cache_control; prices confirmed).

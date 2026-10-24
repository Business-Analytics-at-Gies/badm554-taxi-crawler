Reviewed HEAD **`54918f3`**, read-only. I built all three packs in memory and tested the pinned DuckDB-WASM **1.5.4** engine. All 16 refresher examples ran, all 15 guide SQL blocks parsed after the prescribed blank rewrites, all 15 hint outlines parsed after filling, and each reference returned 7,171 rows. No files changed.

**Round 6 remains OPEN.** [Spec lines 289–294](/Users/vishal/teaching/badm554-taxi-crawler-v2/docs/v2/stage2-resume-2026-10-23.md:289) catch its original full `SELECT coalesce(...) FROM trips;` example, but still leave SQL expressions outside code undetected. The new rule also rejects current content that acceptance explicitly requires to pass.

**FIX**

1. **[P1] The prose rule’s function-call condition misses COALESCE after DuckDB rewrites it.** [Spec lines 291–292](/Users/vishal/teaching/badm554-taxi-crawler-v2/docs/v2/stage2-resume-2026-10-23.md:291), conflicting with [lines 351–352](/Users/vishal/teaching/badm554-taxi-crawler-v2/docs/v2/stage2-resume-2026-10-23.md:351).

   **Concrete scenario:** add “Use coalesce(do_location_id, 0) for a missing drop-off id.” to floor 2’s task, hint text, or control explanation, retaining its current declarations and refreshers. C020 is untaught and has no floor 2 refresher.

   The pinned engine parses `SELECT coalesce(do_location_id, 0)` into an `OPERATOR_COALESCE` expression, with **no function-call node**. Thus the specified “function call in its tree” test does not reject it, although acceptance expressly requires bare `coalesce(x, 0)` in those locations to fail. `ifnull` has the same rewrite.

   **Required correction:** explicitly include rewritten calls and other non-function expression forms in prose detection. Require the bare-COALESCE fixtures to exercise this distinction.

2. **[P1] SQL expressions without SELECT, WITH, or an argument list escape prose detection entirely.** [Spec lines 289–294](/Users/vishal/teaching/badm554-taxi-crawler-v2/docs/v2/stage2-resume-2026-10-23.md:289).

   **Concrete scenario:** add this to a floor 1 control explanation:

   > Use CASE WHEN total_amount < 0 THEN 'negative' ELSE 'other' END for the label.

   This contains none of the specified starting patterns. Every existing scanned SQL source remains unchanged, and floor 1 neither declares nor refreshes `CASE_WHEN`. I verified that the expression parses and runs in the pinned engine. A builder following the prescribed prose search can therefore admit the pack while it displays untaught SQL.

   This leaves R3’s learner-facing concept requirement and the decision record’s teaching gate unenforced.

   **Required correction:** define enforceable coverage for SQL expressions outside code, alongside statements and calls. Add the bare CASE example as a failing fixture; expanding only the function-call test will not close it.

3. **[P2] The new prose rejection rule contradicts the requirement that current prose passes, and its migration is unspecified.** [Spec lines 289–294](/Users/vishal/teaching/badm554-taxi-crawler-v2/docs/v2/stage2-resume-2026-10-23.md:289) versus [line 353](/Users/vishal/teaching/badm554-taxi-crawler-v2/docs/v2/stage2-resume-2026-10-23.md:353).

   **Concrete current failures:**

   - Floor 1 refresher prose contains [`ROUND(value, 2)`](/Users/vishal/teaching/badm554-taxi-crawler-v2/site/floors/floor1/pack.json:40).
   - Floor 2 contains [`COUNT(*)`](/Users/vishal/teaching/badm554-taxi-crawler-v2/site/floors/floor2/pack.json:35); floor 3 contains it in [three refresher explanations](/Users/vishal/teaching/badm554-taxi-crawler-v2/site/floors/floor3/pack.json:35).
   - Floor 1’s displayed check hint contains [`ROW_NUMBER()`](/Users/vishal/teaching/badm554-taxi-crawler-v2/site/floors/floor1/check.js:37).
   - Floor 2’s check message says [`unknown (264), outside_nyc (265)`](/Users/vishal/teaching/badm554-taxi-crawler-v2/site/floors/floor2/check.js:10). DuckDB accepts both labels as function calls when wrapped with SELECT, even though they are ordinary explanatory text.

   I confirmed these parse results. The builder also renders the refresher explanations as ordinary paragraphs. The rule consequently rejects correctly taught SQL explanations and ordinary label descriptions, regardless of their concept declarations. The prescribed guide-blank and column-group rewrites do not address them.

   **Required correction:** explicitly migrate existing SQL-bearing prose into supported code fields or wording, and resolve how ordinary parenthesized labels remain valid. Replace the blanket current-prose acceptance claim with fixtures covering these actual messages and the resulting rendered content.
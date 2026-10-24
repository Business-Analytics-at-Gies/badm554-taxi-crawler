Reviewed HEAD **`d65a628a162e521be6d32126306741bfa1d58b3d`**, read-only. I built floors 1–3 in memory and ran the written prose rule using the pinned DuckDB-WASM **1.5.4** tokenizer and parser. All 16 refresher examples ran, all 15 hint outlines parsed after filling blanks, all 15 guide SQL blocks parsed after the specified rewrites, and each reference returned **7,171 rows**. No files changed.

| Round 7 finding | Status | Spec line |
|---|---|---|
| Rewritten `coalesce` in prose escapes detection | **Closed for the reported example.** Detection now checks the written name immediately before `(`, independently of the rewritten tree. | [293–294](/Users/vishal/teaching/badm554-taxi-crawler-v2/docs/v2/stage2-resume-2026-10-23.md:293); fixture at [363](/Users/vishal/teaching/badm554-taxi-crawler-v2/docs/v2/stage2-resume-2026-10-23.md:363) |
| Bare uppercase `CASE` expressions in prose escape detection | **Closed for the reported example.** Capitalized keyword tokens are rejected, with an explicit CASE fixture. | [291–292](/Users/vishal/teaching/badm554-taxi-crawler-v2/docs/v2/stage2-resume-2026-10-23.md:291); fixture at [364–365](/Users/vishal/teaching/badm554-taxi-crawler-v2/docs/v2/stage2-resume-2026-10-23.md:364) |
| Current prose fails the rule without a specified migration | **Closed for the reported cases.** Migration now covers every flagged span; the spaced numeric labels explicitly pass. A separate migration conflict remains below. | [300–303](/Users/vishal/teaching/badm554-taxi-crawler-v2/docs/v2/stage2-resume-2026-10-23.md:300), [366–368](/Users/vishal/teaching/badm554-taxi-crawler-v2/docs/v2/stage2-resume-2026-10-23.md:366) |

The current prose scan flags the following distinct spellings. Repeated occurrences are grouped; SQL already inside code is excluded.

| Current source | What it flags |
|---|---|
| Floor 1 built guide and learner-visible pack prose | `SQL`, `WITH`, `SELECT`, `GROUP BY`, `HAVING`, `DISTINCT`, `PARTITION BY`, `ORDER BY`, `WHERE`, `ROUND(value, 2)`, `LIMIT`, `COMMIT`, `ROLLBACK` |
| Floor 2 built guide and learner-visible pack prose | `SQL`, `WITH`, `SELECT`, `LEFT`, `JOIN`, `NULL`, `CASE`, `WHEN`, `ELSE`, `IS`, `GROUP BY`, `HAVING`, `COUNT(*)`, `WHERE`, `LIMIT`, `COMMIT`, `ROLLBACK` |
| Floor 3 built guide and learner-visible pack prose | `SQL`, `WITH`, `SELECT`, `WHERE`, `AND`, `OR`, `CASE`, `WHEN`, `ELSE`, `NULL`, `IS`, `GROUP BY`, `HAVING`, `COUNT(*)`, `UNION ALL`, `FILTER`, `LIMIT`, `COMMIT`, `ROLLBACK` |
| Floor 1 pack’s displayed column-type strings | `BIGINT`, `INTEGER`, `TIMESTAMP`, `DOUBLE`, `VARCHAR` |
| Floor 1 `check.js`, line 37 | `WITH`, `ROW_NUMBER()`, `OVER`, `PARTITION BY`, `ORDER BY`, `WHERE`, `SQL` |
| Floor 2 `check.js` messages | Nothing; `unknown (264), outside_nyc (265)` passes |
| Floor 3 `check.js`, lines 6 and 9 | `NULL` |

These occur in refresher titles and explanations, control descriptions, guide headings and passages, task text, hint text, and review-link labels. In particular, DuckDB classifies the ordinary acronym **`SQL`** as a keyword, so the migration reaches beyond the function calls named in the spec.

**A literal implementation can still admit untaught SQL outside the accepted residual, and the prescribed migration can reject otherwise correct current content.** I found no additional actionable conflict in R4 or its leak-test requirements.

**FIX**

1. **[P1] Quotation marks and apostrophes can hide uppercase SQL from the prose rule.** Spec [289–296](/Users/vishal/teaching/badm554-taxi-crawler-v2/docs/v2/stage2-resume-2026-10-23.md:289).

   **Concrete scenario:** add this ordinary paragraph to floor 1’s guide or a control explanation, keeping its current declarations and refreshers:

   > Use "CASE WHEN total_amount < 0 THEN 1 ELSE 2 END" for the label.

   The pinned tokenizer returns the entire double-quoted expression as **one identifier token**. There are no capitalized keyword tokens, no name immediately followed by `(`, and no `SELECT` or `WITH`. I ran all three prose conditions: **zero flags**. The CASE expression itself parses and runs, but floor 1 neither declares nor refreshes `CASE_WHEN`.

   An ordinary contraction also reproduces the problem: `Don't miss CASE WHEN total_amount < 0 THEN 1 ELSE 2 END for the label.` becomes one identifier token in this engine and receives zero flags.

   These are uppercase SQL examples, outside the accepted residual. They leave R3’s learner-facing teaching requirement and decision-record question 3 unenforced.

   **Required correction:** define prose handling for quotation marks, contractions, and tokenizer fallback results so they cannot conceal SQL. Add both examples as failing fixtures, including the rendered guide text.

2. **[P2] Moving every flagged command into code cannot satisfy the current-source acceptance requirement.** Spec [266–277](/Users/vishal/teaching/badm554-taxi-crawler-v2/docs/v2/stage2-resume-2026-10-23.md:266), [300–303](/Users/vishal/teaching/badm554-taxi-crawler-v2/docs/v2/stage2-resume-2026-10-23.md:300), and [367–368](/Users/vishal/teaching/badm554-taxi-crawler-v2/docs/v2/stage2-resume-2026-10-23.md:367).

   **Concrete current scenario:** every floor’s Preview explanation tells the learner to `COMMIT` or `ROLLBACK` before previewing during a transaction—for example, [floor 1’s pack, line 237](/Users/vishal/teaching/badm554-taxi-crawler-v2/site/floors/floor1/pack.json:237). Both words are flagged by the new prose rule.

   The prescribed migration produces `<code>COMMIT</code>` and `<code>ROLLBACK</code>`. DuckDB’s native parser accepts each as a complete statement, so they fall under **Complete SQL** and require tree inspection. But the pinned `json_serialize_sql` returns:

   > Only SELECT statements can be serialized to json!

   Treating these commands as neutral column names through a `SELECT` wrapper would contradict the complete-statement classification and lose their meaning. Adding a refresher cannot resolve this either: [320–323](/Users/vishal/teaching/badm554-taxi-crawler-v2/docs/v2/stage2-resume-2026-10-23.md:320) prohibit transaction statements in refresher examples.

   **Required correction:** specify a supported treatment for explanatory command names, or explicitly authorize a wording change that preserves the Preview guidance required by [dispatch lines 34–39](/Users/vishal/teaching/badm554-taxi-crawler-v2/docs/v2/stage2-dispatch.md:34). Add passing fixtures for the resulting current Preview explanations while retaining rejection of an executable `COMMIT` lesson.
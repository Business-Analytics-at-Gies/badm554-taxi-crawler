Reviewed HEAD **`efe6b464`**, read-only. No files changed.

**Round 8 finding 2 is closed.** [Lines 285–288](/Users/vishal/teaching/badm554-taxi-crawler-v2/docs/v2/stage2-resume-2026-10-23.md:285) classify inline `COMMIT` and `ROLLBACK` as listed phrases before statement parsing, avoiding the serialization limitation. [Lines 351–352](/Users/vishal/teaching/badm554-taxi-crawler-v2/docs/v2/stage2-resume-2026-10-23.md:351) explicitly preserve rejection of a `COMMIT` lesson.

Using the pinned DuckDB **1.5.4** engine, I built floors 1–3 in memory. All **16 refresher examples ran**, all **15 filled hint outlines parsed**, all **15 guide SQL blocks parsed after the specified blank rewrites**, and each reference returned **7,171 rows** against the actual data. I found no additional in-scope false pass for untaught concepts, or separate conflict with R3, R4, the dispatch, or the decision record. The required migration does leave correct current content rejected.

**FIX**

1. **[P2] The migration covers guide notation but misses the same notation in learner-visible pack strings.** Spec [lines 280–282](/Users/vishal/teaching/badm554-taxi-crawler-v2/docs/v2/stage2-resume-2026-10-23.md:280), conflicting with the scan scope at [226–231](/Users/vishal/teaching/badm554-taxi-crawler-v2/docs/v2/stage2-resume-2026-10-23.md:226) and acceptance at [363–365](/Users/vishal/teaching/badm554-taxi-crawler-v2/docs/v2/stage2-resume-2026-10-23.md:363).

   **Concrete current scenario:** floor 1’s [pack.json, line 181](/Users/vishal/teaching/badm554-taxi-crawler-v2/site/floors/floor1/pack.json:181) contains these backtick-marked spans in `rulesText`:

   - `loaded_at = 2024-02-01 06:40` — neither a complete statement nor a valid wrapped expression.
   - `(vendor_id, pickup_at, dropoff_at, pu_location_id, do_location_id, total_amount)` — parses as `row(...)`, which R3b expressly leaves unmapped.

   Floor 2’s [pack.json, line 82](/Users/vishal/teaching/badm554-taxi-crawler-v2/site/floors/floor2/pack.json:82) likewise contains `(row_id, pu_zone, do_zone, zone_flag)` in backticks.

   These strings reach learners: the builder exports `rulesText` to `floors-rules.txt`, and [the tutor’s display action](/Users/vishal/teaching/badm554-taxi-crawler-v2/site/learn/tutor/tools.js:147) shows the active floor’s text. I verified both parse failures and the `row(...)` results with the pinned engine. Rewriting only the specified guide passages leaves these failures intact.

   **Required correction:** extend the migration to code-marked spans in every learner-visible string. Split these column groups into separately marked names, write the timestamp comparison with a typed timestamp literal, and add passing fixtures for the migrated `rulesText` while retaining rejection of actual untaught row construction.
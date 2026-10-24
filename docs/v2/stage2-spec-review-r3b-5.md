Reviewed HEAD **`621628b`**, read-only. I built all three packs in memory and checked them with the pinned DuckDB **1.5.4** binary. All 16 refresher examples ran; all 15 guide SQL blocks parsed after the specified blank rewrite and expression wrapper. No files changed.

**The round 4 finding is closed.** Spec [lines 248–253](/Users/vishal/teaching/badm554-taxi-crawler-v2/docs/v2/stage2-resume-2026-10-23.md:248) explicitly give plain `UNION` and `UNION ALL` separate teaching requirements. [Lines 332–333](/Users/vishal/teaching/badm554-taxi-crawler-v2/docs/v2/stage2-resume-2026-10-23.md:332) require the reported false pass to fail.

A literal implementation can still accept an untaught operation. The prescribed guide migration also leaves current explanatory notation requiring an unrelated SQL lesson.

**FIX**

1. **[P1] Function names and empty/nonempty argument lists do not distinguish different operations offered by the same function.** Spec [lines 238–250](/Users/vishal/teaching/badm554-taxi-crawler-v2/docs/v2/stage2-resume-2026-10-23.md:238).

   Concrete scenario: add `SELECT min(fare_amount, 2) FROM trips;` to floor 3’s guide, retaining its current declarations and refreshers. The guide already uses ordinary `MIN`, covered by C022. In the pinned engine, the added query introduces **no new field names, expression classes, types, function names, flag values, empty/nonempty list states, or keywords** beyond current content. A builder can inspect every argument and still map both calls to C022.

   But these calls teach different operations. I verified against the taxi data: ordinary `min(fare_amount)` returns `-102.4`; the two-argument call returns the list `[-102.4, -100]`. It selects the two smallest values and returns them together. The current guide and lessons do not teach that operation.

   Require supported function calls to specify argument counts and any other distinctions needed to identify the operation. The two-argument `MIN`/`MAX` forms should fail unless separately declared and taught. Add fixtures that preserve ordinary `MIN`/`MAX` as positive controls.

2. **[P2] The expression wrapper turns current column-group notation into an untaught row-construction operation.** Spec [lines 269–273](/Users/vishal/teaching/badm554-taxi-crawler-v2/docs/v2/stage2-resume-2026-10-23.md:269), conflicting with the current-source acceptance at [lines 338–340](/Users/vishal/teaching/badm554-taxi-crawler-v2/docs/v2/stage2-resume-2026-10-23.md:338).

   Concrete examples are floor 2’s [`(row_id, pu_zone, do_zone, zone_flag)`](/Users/vishal/teaching/badm554-taxi-crawler-v2/site/floors/floor2/guide.html:98) and floor 3’s [`(row_id, reason)`](/Users/vishal/teaching/badm554-taxi-crawler-v2/site/floors/floor3/guide.html:96). These explain which columns the check compares.

   Under the prescribed wrapper, DuckDB parses each as a `row(...)` function that constructs a structured value. Neither pack declares or demonstrates that operation. Rewriting comment blanks does not change these passages, so a correctly restrictive map rejects the current packs. Treating `row(...)` as neutral would instead authorize actual row-construction SQL without teaching it.

   Explicitly include these passages in the guide migration: write the column names separately, without enclosing the whole group in one `<code>` element, or define a narrowly bounded category for explanatory name lists. Add positive fixtures for the rewritten passages while retaining rejection of untaught row-construction expressions.
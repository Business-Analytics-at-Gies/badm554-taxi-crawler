Reviewed HEAD **7a63e9a**, read-only. I built the three packs in memory and tested with the pinned DuckDB **1.5.4** engine. All **16 refresher examples ran**. All **15 guide SQL blocks parsed** after applying the specified blank rewrite and expression wrapper in memory. No files changed.

| Round 3 finding | Status | Spec line |
|---|---|---|
| Active versus inactive fields, including `DISTINCT ON` | **Closed for the reported scenario.** `DISTINCT ON` explicitly needs its own teaching credit, and its passing floor 1 reproduction must fail the gate. | [248–253](</Users/vishal/teaching/badm554-taxi-crawler-v2/docs/v2/stage2-resume-2026-10-23.md:248>), [323–328](</Users/vishal/teaching/badm554-taxi-crawler-v2/docs/v2/stage2-resume-2026-10-23.md:323>) |
| Blanket requirement that earlier-review inputs all fail | **Closed.** Fixtures now state their context and expected result; permitted guide names and phrases explicitly pass. | [302–307](</Users/vishal/teaching/badm554-taxi-crawler-v2/docs/v2/stage2-resume-2026-10-23.md:302>) |
| Standalone `CASE` blocks inside `<pre>` | **Closed.** Guide expression blocks receive an inspected `SELECT` wrapper, explicitly including both reported `CASE` blocks. | [266–270](</Users/vishal/teaching/badm554-taxi-crawler-v2/docs/v2/stage2-resume-2026-10-23.md:266>) |

A literal implementation can still admit an untaught form through the remaining defect below. I found no separate requirement forcing a correct current pack to fail after the specified migration, or another conflict with R3, R4, the dispatch, or the decision record.

**FIX**

1. **[P1] Treating a false flag as neutral can authorize duplicate-removing `UNION` using only `UNION ALL` teaching.** Spec [248–250](</Users/vishal/teaching/badm554-taxi-crawler-v2/docs/v2/stage2-resume-2026-10-23.md:248>), alongside the set-operation flag requirement at [241–243](</Users/vishal/teaching/badm554-taxi-crawler-v2/docs/v2/stage2-resume-2026-10-23.md:241>).

   Concrete scenario: add `SELECT * FROM trips UNION SELECT * FROM trips` to floor 3’s guide, retaining its existing declarations and `UNION_ALL` refresher. That lesson teaches stacking rows while keeping duplicates; it does not teach plain `UNION`, which removes duplicates. The graph supplies no separate taught coverage.

   In the pinned engine, this introduces no new keyword, expression type, or operation type beyond the current packs. The distinguishing flag is `setop_all=false`, where the existing lesson uses `true`. Lines 248–250 allow the builder to treat false as inactive and neutral, so the added query can pass without separate teaching credit. I verified the behavioral difference with the current lesson’s tiny tables: repeated inputs produce **two rows with `UNION ALL`, one with `UNION`**.

   Define neutral values separately for each field according to their meaning. Require both states of this flag to be classified: plain `UNION` must fail unless separately declared and taught. Add a fixture that retains the current `UNION_ALL` refresher and introduces plain `UNION`, with an expected failure.
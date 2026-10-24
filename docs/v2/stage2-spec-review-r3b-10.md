Reviewed `56f3031` read-only, using committed content and the pinned DuckDB **1.5.4** engine in memory. No files changed.

**Round 9’s finding is closed.** Spec [lines 283–288](/Users/vishal/teaching/badm554-taxi-crawler-v2/docs/v2/stage2-resume-2026-10-23.md:283) extend the migration to every learner-visible string, explicitly including the reported `rulesText` cases. [Lines 364–365](/Users/vishal/teaching/badm554-taxi-crawler-v2/docs/v2/stage2-resume-2026-10-23.md:364) require the migrated text to pass.

All 16 current refresher examples ran. All 15 guide SQL blocks, 15 hint outlines and 49 `rulesText` code spans parsed after the specified rewrites; each reference returned 7,171 rows. I found no separate requirement forcing a correct current pack to fail after migration, or another conflict with R4, the dispatch or the decision record. One untaught-concept escape remains.

**FIX**

1. **[P1] Treating column references as neutral misses whole-row structured values.** Spec [lines 242–248](/Users/vishal/teaching/badm554-taxi-crawler-v2/docs/v2/stage2-resume-2026-10-23.md:242), alongside the requirement at [lines 279–282](/Users/vishal/teaching/badm554-taxi-crawler-v2/docs/v2/stage2-resume-2026-10-23.md:279) to leave `row(...)` unmapped.

   **Concrete scenario:** add this query inside `<pre><code>` in floor 3’s guide, retaining its current declarations and refreshers:

   ```sql
   SELECT t FROM trips t;
   ```

   I ran it against the committed floor data. It returns **7,171 rows with one structured column**, each value containing the entire trip. The pack does not teach that operation.

   DuckDB labels `t` as an ordinary `COLUMN_REF` in its parse tree—the category the spec expressly permits to be neutral. Its only keyword tokens are `SELECT` and `FROM`; there is no `row(...)` function or unfamiliar tree feature to reject. A builder can therefore implement both prescribed layers and accept this guide addition without requiring teaching credit for structured values. This leaves R3’s learner-facing concept rule unenforced even though explicit row construction must fail.

   **Required correction:** distinguish ordinary column references from references that return an entire table row before assigning neutral status. Reject whole-row references unless separately declared and demonstrated, and handle uncertain cases conservatively. Add the query above as a failing fixture under floor 3’s existing declarations, with an ordinary column selection as a passing control.
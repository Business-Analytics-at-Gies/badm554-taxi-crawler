Reviewed HEAD **`7a00c75`**, read-only. No files changed. Using the pinned DuckDB **1.5.4**, all 16 refresher examples ran, all 15 guide SQL blocks parsed after the specified rewrites in memory, and all three reference queries returned 7,171 rows.

| Round 5 finding | Status | Current spec lines |
|---|---|---|
| Function overloads such as `min(x, 2)` | **Closed.** Function entries must include argument counts. Explicit fixtures reject two-argument `MIN`/`MAX` while preserving ordinary calls. | [246–248](/Users/vishal/teaching/badm554-taxi-crawler-v2/docs/v2/stage2-resume-2026-10-23.md:246), [339–340](/Users/vishal/teaching/badm554-taxi-crawler-v2/docs/v2/stage2-resume-2026-10-23.md:339) |
| Guide column groups parsing as `row(...)` | **Closed.** The spec requires separate names in the guide, keeps `row(...)` unmapped, and tests both outcomes. | [275–278](/Users/vishal/teaching/badm554-taxi-crawler-v2/docs/v2/stage2-resume-2026-10-23.md:275), [340–341](/Users/vishal/teaching/badm554-taxi-crawler-v2/docs/v2/stage2-resume-2026-10-23.md:340) |

A literal implementation can still pass a pack that displays an untaught concept. I found no separate requirement forcing the correctly migrated current packs to fail, or another unbuildable requirement or conflict with R4.

**FIX**

1. **[P2] SQL displayed outside `<code>` and `<pre>` can escape the gate.** Spec [226–228](/Users/vishal/teaching/badm554-taxi-crawler-v2/docs/v2/stage2-resume-2026-10-23.md:226) and [261–284](/Users/vishal/teaching/badm554-taxi-crawler-v2/docs/v2/stage2-resume-2026-10-23.md:261) define the scanned sources without requiring other learner-facing text to keep SQL in those sources.

   **Concrete scenario:** append this to floor 2’s Answer control explanation:

   > Use SELECT coalesce(do_location_id, 0) FROM trips; to replace a missing drop-off id with zero.

   The actual [pack builder, line 24](/Users/vishal/teaching/badm554-taxi-crawler-v2/tools/build-floor-packs.mjs:24) displays that text in an ordinary paragraph. I reproduced the build entirely in memory: the query appeared in the generated guide, while every guide `<code>`/`<pre>` snippet, reference, refresher example and hint outline remained unchanged. Floor 2 still declared no C020 and supplied no C020 refresher. The query also ran against representative input in the pinned engine.

   C020 is untaught in the graph. Because the specified scan inputs are identical, a gate implementing R3b literally cannot distinguish this pack from the passing original. This leaves a gap in R3’s [learner-facing SQL requirement, lines 182–194](/Users/vishal/teaching/badm554-taxi-crawler-v2/docs/v2/stage2-resume-2026-10-23.md:182) and the decision record’s teaching gate.

   **Required correction:** make SQL in control explanations, refresher prose, task text and other guide text use structured, scanned snippet fields; explicitly prohibit SQL examples outside those fields. Add this generated-guide reproduction as a failing fixture, with a positive control that supplies a demonstrated C020 refresher.
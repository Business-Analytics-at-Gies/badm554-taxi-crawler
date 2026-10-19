FIX

1. **[P1] Floor 3 still passes changed numbers and timestamps.**  
   [site/floors/floor3/check.js:34](/Users/vishal/teaching/badm554-taxi-crawler-v2/site/floors/floor3/check.js:34)  
   After running the floor 3 reference solution, each of these changes still passes every rule:
   - `UPDATE trips_clean SET trip_distance = trip_distance + 0.001;`
   - `UPDATE trips_clean SET pickup_at = pickup_at + INTERVAL '1 microsecond';`
   - Changing `row_id` to `DECIMAL(18,1)` and adding `0.1`.

   The check compares row identities after rounding them to integers, and quarantine reasons, but never checks the remaining values. This is carried forward from the old checker; the requested all-floor precision fix remains incomplete. **Suggested fix:** check unchanged values across both output tables, preserving exact non-money values and timestamps, with money compared to cents. Add cases for both tables.

2. **[P1] Floors 1 and 2 reject unchanged distances represented as decimals.**  
   [site/game/db/check-helpers.js:56](/Users/vishal/teaching/badm554-taxi-crawler-v2/site/game/db/check-helpers.js:56)  
   Run either floor’s reference solution, then:
   `ALTER TABLE trips_clean ALTER COLUMN trip_distance TYPE DECIMAL(18,2);`

   All source distances already have at most two decimal places. The old checker passes this result; the new checker rejects **6,434 rows**. It treats the binary representation of a DOUBLE such as `1.1` as different from decimal `1.10`. **Suggested fix:** preserve equivalent numeric representations while continuing to reject additional decimal digits and genuinely changed values. Test DOUBLE-to-DECIMAL distances on both floors alongside the tiny-change rejection cases.

3. **[P2] The move also changes acceptance of unchanged numeric values stored as text.**  
   [site/game/db/check-helpers.js:94](/Users/vishal/teaching/badm554-taxi-crawler-v2/site/game/db/check-helpers.js:94)  
   After either floor 1 or floor 2 reference solution, run:
   `ALTER TABLE trips_clean ALTER COLUMN fare_amount TYPE VARCHAR;`

   The old checker passes; the new checker rejects all **7,171 rows**, although the amounts are unchanged. Floor 1 likewise rejects unchanged `row_id` values converted to VARCHAR. The new comparison gives text and numeric values different identities instead of retaining the old supported conversions. **Suggested fix:** preserve those conversions, particularly the existing money-to-cents comparison, without discarding precision from actual numeric values. Add acceptance tests for unchanged numeric text.

4. **[P2] A pack checker returning no rules awards an automatic pass.**  
   [site/game/db/floors.js:42](/Users/vishal/teaching/badm554-taxi-crawler-v2/site/game/db/floors.js:42)  
   A pack containing `export async function check() { return []; }` satisfies the builder’s non-empty-file requirement. The engine then returns `{ pass: true, rules: [] }`, even with no learner solution. I reproduced that result using the extracted production check function. **Suggested fix:** reject empty or malformed rule results, require explicit Boolean outcomes, and validate the expected rule identities so accidentally omitted checks cannot award a pass.

Verified:

- **Database suite: 294 passed**, including legacy solutions, row-count and repeated-row cases, fourth-pack loading/checking, and generation drift checks.
- Ran the old and new check functions against the same taxi data in an in-memory DuckDB database to reproduce findings 1–3. Confirmed the approved floor 1 `+0.001` distance change now fails.
- Regenerated assets in memory: **all 21 matched committed files**, including both HTML pages, server tool choices, and tutor summaries. A committed test checks for drift.
- Focused browser tests: **8 passed, 2 skipped**. Desktop height behavior, 375 px layout, JavaScript-off guide content, direct-floor context, review links, and emulated iPhone typing passed. The skipped cases were fourth-pack browser tests requiring the real engine.
- Found no additional actionable omissions in the current guide’s dispatch requirements.
- All protected Rerun paths and the three named shared files are untouched. No source files were modified.

Could not verify:

- The server suite: **3 passed; 66 were blocked by temporary-folder permission errors**.
- The additional browser run with the real engine: blocked by permission errors writing Playwright’s result file.
- Real iPhone Safari behavior. Emulated WebKit passed, but the dispatch states it also passed before the fix, so it does not establish that #32 is fixed on the phone.
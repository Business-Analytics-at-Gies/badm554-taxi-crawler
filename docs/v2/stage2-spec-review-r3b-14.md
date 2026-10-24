Reviewed **`89157ca`**, read-only, using committed sources throughout. No files changed.

**Yes: `json_serialize_plan(sql, optimize := false)` works in the exact vendored DuckDB 1.5.4 binary.** I verified its checksum against `VERSION.json`.

| Operation | What the bound plan exposes |
|---|---|
| Implicit `current_schema` / quoted `"current_timestamp"` | `BOUND_FUNCTION`: `current_schema` / `get_current_timestamp` |
| Whole-row value | `BOUND_FUNCTION`: `struct_pack` |
| Struct field access | `BOUND_FUNCTION`: `struct_extract` |
| Struct expansion, `payload.*` | `BOUND_FUNCTION`: `struct_extract`, plus the inner `struct_pack` |

**Both round 13 findings are closed for their reported examples.** The quoted clock-function example is rejected by the new function exclusions. The whole-row, field-access and expansion examples likewise expose functions that must remain unlisted. The ordinary-column controls remain distinguishable.

I found **no unavoidable current-pack rejection after the full migration**. All three references returned **7,171 rows**; all **16 lessons ran**; and the references, lessons, **15 outlines and 15 guide blocks** bound after the required rewrites. Floor 2’s standalone CASE example also needs its `t.` qualifiers removed under the blanket migration at lines 306–312; the specified fills alone cannot supply that alias. The bound allowlist needs ordinary **`round` with two arguments**, already demonstrated by floor 1’s refresher. Neither requires admitting the forbidden structured or session functions.

A pack can still pass while displaying an untaught operation through the two defects below. No finding concerns SQL in prose.

**FIX**

1. **[P1] Disabling optimization does not preserve unused CTE bodies.** Spec [lines 271–275](/Users/vishal/teaching/badm554-taxi-crawler-v2/docs/v2/stage2-resume-2026-10-23.md:271), particularly the claim that every bound function remains visible.

   Add this code block to floor 1’s guide, retaining its current declarations and refreshers:

   ```sql
   WITH ghost AS (
     SELECT "current_timestamp" AS env
   )
   SELECT row_id FROM trips_raw;
   ```

   **Verified:** serialization succeeds, but the bound plan contains **no `get_current_timestamp` function and no `ghost` body**. The parsed tree records the quoted name as an ordinary column reference, which lines 254–255 make neutral. The remaining constructs are already supported by floor 1. A gate following the written rules can therefore accept this code without teaching the clock operation.

   The same omission hides whole-row construction:

   ```sql
   WITH ghost AS (SELECT t FROM trips_raw t)
   SELECT row_id FROM trips_raw;
   ```

   Here the bound plan contains no `struct_pack`.

   This also affects references: I inserted the unused clock CTE into floor 1’s actual reference. It still returned **7,171 rows**, with **zero differences**, passed the committed native read policy, and exposed no bound scalar functions.

   **Required correction:** require coverage of every parsed query body, including unused CTEs. Bind those bodies in their proper context or reject bodies whose contents are absent from the inspected plan. Add both examples as failing fixtures.

2. **[P2] Checking bound expression classes and functions still admits hidden storage columns.** Spec [lines 254–255](/Users/vishal/teaching/badm554-taxi-crawler-v2/docs/v2/stage2-resume-2026-10-23.md:254) and [283–286](/Users/vishal/teaching/badm554-taxi-crawler-v2/docs/v2/stage2-resume-2026-10-23.md:283).

   Add this code block to floor 1’s guide:

   ```sql
   SELECT rowid FROM trips_raw;
   ```

   **Verified:** it reads DuckDB’s hidden storage row number. The first values are **0, 1, 2**, while the supplied `row_id` values are **1, 2, 3**. `rowid` is absent from both the pack’s column definitions and `DESCRIBE trips_raw`.

   Nevertheless, the tokenizer calls it an identifier, the parsed tree calls it a column reference, and the bound expression is **`BOUND_REF`**, just like an ordinary supplied column. It introduces no bound function. The committed native read policy accepts it.

   The prescribed checks can therefore admit an untaught engine-specific source of row identity without any declaration or refresher.

   **Required correction:** verify that bound column references resolve to supplied columns or columns defined by the query. Reject hidden storage columns unless separately mapped and taught. Add a failing `rowid` fixture and retain `SELECT row_id FROM trips_raw` as a passing control.
Reviewed **`0138238`**, read-only, using committed sources and the exact vendored DuckDB **1.5.4** binary. Its checksum matches `VERSION.json`. No files changed.

Both round 14 findings are **closed for their reported examples**:

- **Unused CTE bodies:** lines 280–283 explicitly require unreachable CTEs to fail.
- **Hidden `rowid`:** lines 276–279 require binding against views. Verified: `rowid` fails there, while supplied `row_id` binds.

I found **no unavoidable current-pack failure after the full specified migration**. All three references returned **7,171 rows**; all **16 lessons ran**; and the references, **15 outlines and 15 migrated guide blocks** bound successfully. Two other escapes remain. Neither concerns prose.

**FIX**

1. **[P1] Constant `LIMIT` expressions lose their contents even with optimization disabled.** Spec [lines 271–275](/Users/vishal/teaching/badm554-taxi-crawler-v2/docs/v2/stage2-resume-2026-10-23.md:271), together with the bound allowlist at [288–292](/Users/vishal/teaching/badm554-taxi-crawler-v2/docs/v2/stage2-resume-2026-10-23.md:288).

   Add this code block to floor 2’s guide, keeping its current declarations and refreshers:

   ```sql
   SELECT row_id FROM trips
   LIMIT ("current_timestamp" IS NOT NULL);
   ```

   **Verified:** with `optimize := false`, its returned plan is **identical to `SELECT row_id FROM trips LIMIT 1`**. DuckDB evaluates the limit while preparing the query, leaving no `get_current_timestamp` function to reject. The parsed tree records the quoted name as a neutral column reference. The remaining constructs are already covered by floor 2.

   This also works in a reference: appending `LIMIT CASE WHEN "current_timestamp" IS NOT NULL THEN 100000 ELSE 0 END` to floor 2’s current reference retained **7,171 rows with zero differences**, passed the committed native read policy, and exposed no clock function.

   **Required correction:** inspect limit expressions before their evaluation removes name resolution information, or reject cases whose original references cannot be verified. Add the guide and reference examples as failing fixtures. Apply the same protection to `OFFSET`, where I also verified this disappearance.

2. **[P1] Implicit user and role names become constants, bypassing the function exclusions.** Spec [lines 254–255](/Users/vishal/teaching/badm554-taxi-crawler-v2/docs/v2/stage2-resume-2026-10-23.md:254) and [288–291](/Users/vishal/teaching/badm554-taxi-crawler-v2/docs/v2/stage2-resume-2026-10-23.md:288).

   Add this code block to floor 1’s guide:

   ```sql
   SELECT "current_user";
   ```

   **Verified:** it returns **`duckdb`**. The tokenizer reports an identifier; the parsed tree reports a column reference. Binding expands DuckDB’s built-in macro into a constant: the returned plan is **identical to `SELECT 'duckdb'`**, including with optimization disabled. There is no session-function name for the allowlist to reject. Quoted `"session_user"`, `"current_role"` and `"user"` behave the same way.

   Adding `AND "current_user" = 'duckdb'` to floor 1’s reference likewise retained **7,171 rows with zero differences** and passed the committed native read policy.

   **Required correction:** require evidence that each parsed reference resolves to a visible supplied or query-defined column, including references that binding replaces with constants. Add these implicit macro forms as failing fixtures. Preserve the valid control `SELECT current_user FROM (SELECT 7 AS current_user) t`, which I verified returns **7**.
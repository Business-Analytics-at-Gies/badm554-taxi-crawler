Reviewed **`873c7f3`**, read-only, using committed sources throughout. I ran the exact vendored DuckDB **1.5.4** engine and extensions in memory and verified their checksums against the committed manifest. No files changed.

Both round 16 findings are **closed**:

| Finding | Result |
|---|---|
| `HAVING` precedence with a built-in name | The built-in-name ban at [line 308](/Users/vishal/teaching/badm554-taxi-crawler-v2/docs/v2/stage2-resume-2026-10-23.md:308) rejects the alias and reference before precedence matters. |
| Surplus CTE column names | The rule at [line 315](/Users/vishal/teaching/badm554-taxi-crawler-v2/docs/v2/stage2-resume-2026-10-23.md:315) rejects surplus names. The built-in-name ban independently rejects the reported `current_user` example. |

The ordinary passing controls work in the pinned engine. In particular, `SELECT count(*) AS copies FROM trips_raw HAVING copies > 1` is valid and returns one row with **`copies = 7345`**. The one-column `rides(id)` CTE returns **1**.

With all four prescribed layers applied, **I found no remaining way to pass a pack while introducing an untaught concept through the specified SQL sources**. I also found **no unavoidable current-source failure after migration**: all 16 lessons ran; all 15 migrated guide SQL blocks and 15 hint outlines bound; each reference returned 7,171 rows. Checking every collected current source name with the built-in probe found **no collisions**.

One required acceptance outcome still contradicts the new rule.

**FIX**

1. **[P2] Line 433 still requires a built-in-name control to pass.** Spec [line 433](/Users/vishal/teaching/badm554-taxi-crawler-v2/docs/v2/stage2-resume-2026-10-23.md:433), conflicting with item 2c at [line 312](/Users/vishal/teaching/badm554-taxi-crawler-v2/docs/v2/stage2-resume-2026-10-23.md:312).

   The acceptance list requires this query to pass:

   ```sql
   SELECT current_schema FROM (SELECT 7 AS current_schema) t;
   ```

   **Verified:** DuckDB returns **7**, but the required standalone probe, `SELECT "current_schema"`, also binds. Item 2c therefore requires the gate to reject both the alias and the reference. An implementation cannot satisfy both requirements.

   Update this control to expect `built-in name current_schema: rename it`, and retain an ordinary-column passing control using a renamed column. I verified that:

   ```sql
   SELECT active_schema_value
   FROM (SELECT 7 AS active_schema_value) t;
   ```

   returns **7**, while its standalone name probe fails to bind. This correction preserves the intentional built-in-name ban and makes the acceptance list consistent with it.
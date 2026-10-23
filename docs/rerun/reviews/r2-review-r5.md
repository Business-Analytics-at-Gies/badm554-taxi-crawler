**Verdict: FIX. Two actionable defects remain.**

1. **[P2] Mixed-case function names bypass the tutor’s read-only check — [site/game/db/sql.js:111](/Users/vishal/teaching/badm554-taxi-crawler-rerun/site/game/db/sql.js:111).**

   The check lowercases the called function’s name, but compares it against DuckDB’s function list using a case-sensitive match. A learner-created function with a mixed-case name is missed, and the missing match is treated as safe.

   Reproduction in the learner console on floor 1:

   ```sql
   CREATE SEQUENCE private_sequence START 41;
   CREATE MACRO main.SecretNext()
   AS nextval('floor1.private_sequence');
   ```

   **Observed:** the tutor’s `SELECT SecretNext()` succeeds and returns `41`. The learner’s subsequent `SELECT nextval('private_sequence')` returns `42`. The tutor has changed learner state, and its rollback does not undo that change.

   Match function names case-insensitively and refuse execution when a called function cannot be classified.

2. **[P2] The tutor can read learner-owned tables through unqualified names — [site/game/db/sql.js:95](/Users/vishal/teaching/badm554-taxi-crawler-rerun/site/game/db/sql.js:95).**

   The restriction checks schema names explicitly written in the statement. It does not check which table DuckDB actually resolves. Setting the tutor’s default schema still permits fallback to `main`.

   Reproduction in the learner console:

   ```sql
   CREATE TABLE main.private_note AS SELECT 987 AS row_id;
   ```

   **Observed:** `tutorQuery('SELECT row_id FROM private_note')` returns `[[987]]`, although that table exists only in the learner-created workspace. `lensRows` accepts the same query too. Explicit references to learner-created schemas outside the fixed blocked list are also allowed.

   Check the resolved tables against the tutor’s own copies, including unqualified references and references through views.

The old handwritten SQL scanner is gone. DuckDB supplies parsing and tokens, and the checked malformed-input and missing-parser cases refuse execution. I found no additional Rerun grading defect: the documented pipelines and earlier grading regressions produced their expected outcomes. All 32 existing Taxi Crawler floor checks also retained their expected results.

Verification used the pinned DuckDB-WASM engine and actual application functions with in-memory startup and data adapters; **122 selected tests passed**. Full browser and hard-restart verification remained unavailable because the environment blocks the tests’ local web server. I made no file changes.
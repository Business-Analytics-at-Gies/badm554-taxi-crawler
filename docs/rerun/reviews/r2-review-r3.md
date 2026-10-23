**Verdict: FIX.** Two splitter defects remain.

1. **[P2] A valid continued escaped string causes a correct pipeline to fail — [site/game/db/sql.js:58](/Users/vishal/teaching/badm554-taxi-crawler-rerun/site/game/db/sql.js:58).**

   Prepend this helper to the unchanged floor-3 reference:

   ```sql
   CREATE OR REPLACE TABLE note AS
   SELECT E'one'
          'it\'s; two' AS note;
   ```

   DuckDB accepts this: string fragments separated by a newline are joined, and the second fragment retains the first fragment’s escape rules. The splitter treats the second fragment as an ordinary string and splits at its internal semicolon.

   **Result:** the correct pipeline fails from `day1-first` with an unterminated-string error. The Taxi Crawler console uses the same splitter, so the same valid helper also interrupts console execution. Preserve escape handling across continued string fragments.

2. **[P2] An unclosed trailing block comment is discarded, allowing invalid SQL to pass — [site/game/db/sql.js:31](/Users/vishal/teaching/badm554-taxi-crawler-rerun/site/game/db/sql.js:31).**

   Append this after the floor-3 reference’s final semicolon:

   ```sql
   /* unfinished
   ```

   DuckDB rejects the complete script with an “unterminated /* comment” error. The scanner instead treats the remainder as a comment, which `splitStatements` silently drops.

   **Result:** all seven Rerun runs pass, including the execution rule, although DuckDB cannot execute the submitted script as written. An unfinished block comment must produce an error or remain in the text sent to DuckDB.

The earlier raw-table, decimal-precision and object-type bypasses are closed in the cases checked: all **14 earlier review regressions passed**. The **36 documented reference/example scenarios** and **12 existing SQL fixtures across all seven Rerun runs** also produced their expected outcomes. The escaped-string fix remains incomplete as described above.

Verification used the vendored DuckDB-WASM engine and the current grading logic, with in-memory adapters replacing worker startup and data loading. The browser suite could not start because the sandbox blocks its local server; full browser verification remains unavailable. No files were edited.
**Verdict: FIX.** Three actionable defects allow incorrect pipelines to pass.

1. **[P1] A temporary copy can hide deletion of the original raw table — [site/rerun/db/db.js:84](/Users/vishal/teaching/badm554-taxi-crawler-rerun/site/rerun/db/db.js:84).**

   The raw-preservation check reads `main.raw_trips`, which can resolve to a temporary table instead of the original. Prepend this to the floor-3 reference script:

   ```sql
   CREATE TEMP TABLE IF NOT EXISTS raw_trips AS
     SELECT * FROM memory.main.raw_trips;
   DELETE FROM memory.main.raw_trips;
   ```

   All seven runs pass, including `raw_unchanged`, while the original raw table contains **zero rows after every run**. New days are also appended to the temporary copy by the unqualified insertion at line 166.

   Bind both loading and preservation checks to the original table’s full database/schema identity, and prevent a temporary object from substituting for it.

2. **[P2] Decimal conversion hides changes to trip keys — [site/rerun/db/db.js:18](/Users/vishal/teaching/badm554-taxi-crawler-rerun/site/rerun/db/db.js:18).**

   `castDecimalToDouble: true` loses precision before the result reaches the trusted comparison database. In the floor-3 reference, replace `SELECT * FROM` with:

   ```sql
   SELECT * REPLACE (
     CAST(trip_id AS DECIMAL(38,20))
       + CAST(0.00000000000000000001 AS DECIMAL(38,20))
       AS trip_id
   ) FROM
   ```

   Every output key differs from its raw key, so no output row has unchanged complete-row provenance. Nevertheless, **all seven runs pass**, including provenance and content: the added fraction disappears during transfer. I separately checked that all 7,171 final output keys retain that fraction in the pipeline database.

   Preserve exact decimal values during transfer and comparison; the contract permits rounding only for monetary fields.

3. **[P2] A table in another database can make a view satisfy the table requirement — [site/rerun/db/db.js:96](/Users/vishal/teaching/badm554-taxi-crawler-rerun/site/rerun/db/db.js:96).**

   The table-type lookup filters by schema and name, but does not identify the database containing the output being measured. Prepend:

   ```sql
   ATTACH IF NOT EXISTS ':memory:' AS decoy;
   CREATE TABLE IF NOT EXISTS decoy.main.trips_clean AS SELECT 1;
   ```

   Then use the floor-3 reference with `CREATE OR REPLACE VIEW` instead of `CREATE OR REPLACE TABLE`.

   **All seven runs pass.** The grader reads the correct rows from `memory.main.trips_clean`, which is a view, but accepts the `BASE TABLE` classification from `decoy.main.trips_clean`. This bypasses the API’s explicit rejection of view outputs.

   Check the type of the exact object used for the counts and content comparison.

These examples were reproduced with the vendored DuckDB-WASM engine and the checker’s execution/comparison code, using in-memory adapters for database startup and data loading. The browser acceptance suite could not start because the sandbox blocks its local server (`listen EPERM`). No files were edited.
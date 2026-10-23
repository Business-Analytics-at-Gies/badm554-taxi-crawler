Reviewed `e7e5fe6` and `6543528` on `v2/stage2`. No repository files were edited, committed, or pushed.

| Suite | Passed | Skipped | Failed |
|---|---:|---:|---:|
| Database | 2,526 | 0 | 0 |
| Stub browser | 177 | 25 | 0 |
| Real-database browser | 197 | 5 | 0 |
| Server | 69 | 0 | 0 |

**FIX**

1. **[P2] An unfinished refresher earns teaching credit.** At [site/floors/concept-gate.mjs:197](/Users/vishal/teaching/badm554-taxi-crawler-v2/site/floors/concept-gate.mjs:197), finding a concept’s keywords is enough to approve its refresher—even when the example cannot run.

   Concrete failing input: an M7 pack declaring `C005` and `CASE_WHEN`, reference `SELECT CASE WHEN true THEN 1 END`, and `refreshes: { CASE_WHEN: "Broken example" }`. Give that lesson this SQL:

   ```sql
   SELECT CASE
   WHEN ___ THEN
   ```

   The pack metadata validates and the gate returns no errors. Running the example produces `Parser Error: syntax error at end of input`. Require a runnable example before granting refresher credit.

2. **[P2] LAG and LEAD escape their specific concept check.** At [site/floors/concept-gate.mjs:67](/Users/vishal/teaching/badm554-taxi-crawler-v2/site/floors/concept-gate.mjs:67), function detection omits `C030`, which the snapshot identifies as LAG/LEAD, taught in M3I3.

   Concrete failing input: an M2 pack declaring only `C005`, `C022`, and `C025`, with a local C025 refresher containing `SELECT sum(1) OVER () AS total`, and reference `SELECT lag(1) OVER () AS previous`. The gate returns no errors despite C030 being neither declared nor refreshed. `LEAD` passes the same way. Detect C030 in both complete queries and unfinished examples.

3. **[P2] Temporary table creation bypasses C053.** At [site/floors/concept-gate.mjs:133](/Users/vishal/teaching/badm554-taxi-crawler-v2/site/floors/concept-gate.mjs:133), table-creation detection misses `TEMP` and `TEMPORARY` between `CREATE` and `TABLE`.

   Concrete failing input: an M7 pack declaring only `C005`, reference `SELECT 1`, and guide SQL `<code>CREATE TEMP TABLE t AS SELECT 1;</code>`. The gate returns no errors and detects only C005 in that guide example. `CREATE TEMPORARY TABLE` also passes. Recognize these forms as C053 so they require its declaration and local teaching proof.
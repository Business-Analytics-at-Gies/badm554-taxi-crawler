Reviewed `6e5ffde` and `c721a93` on `v2/stage2`. No repository files were edited, committed, or pushed.

| Suite | Passed | Skipped | Failed |
|---|---:|---:|---:|
| Database | 2,531 | 0 | 0 |
| Stub browser | 183 | 25 | 0 |
| Real-database browser | 203 | 5 | 0 |
| Server | 69 | 0 | 0 |

**FIX**

1. **[P2] A named window lets a running total escape C029.** [site/floors/concept-gate.mjs:170](/Users/vishal/teaching/badm554-taxi-crawler-v2/site/floors/concept-gate.mjs:170)

   Concrete failing input: an M2 pack declaring `C005`, `C008`, `C022`, `C025`, and `C027`, with local C025/C027 lessons demonstrating `sum(1) OVER ()` and `avg(1) OVER (ORDER BY 1)`. Give its reference this query:

   ```sql
   SELECT sum(1) OVER w WINDOW w AS (ORDER BY 1)
   ```

   Pack validation succeeds and the gate returns no errors, although the running-total concept C029 is taught in M3 and is neither declared nor refreshed. The equivalent inline window is detected. Include named-window definitions in the running-total check.

2. **[P2] A valid M3 window example is wrongly rejected as an M7 validation concept.** [site/floors/concept-gate.mjs:173](/Users/vishal/teaching/badm554-taxi-crawler-v2/site/floors/concept-gate.mjs:173)

   Concrete failing input: an M3 pack declaring `C005`, `C008`, `C022`, `C025`, and `C027`, with this reference:

   ```sql
   SELECT avg(1) OVER (
     ORDER BY 1 ROWS BETWEEN 1 PRECEDING AND CURRENT ROW
   )
   ```

   The gate reports `reference: undeclared C085`. Replacing the frame with the equivalent `ROWS 1 PRECEDING` passes. The graph places window-frame awareness under C027; this example performs no edge-case validation. Recognize `BETWEEN` in its SQL context rather than automatically requiring C085.

3. **[P2] A refresher receives credit even though it fails when run independently.** [site/floors/concept-gate.mjs:235](/Users/vishal/teaching/badm554-taxi-crawler-v2/site/floors/concept-gate.mjs:235)

   Concrete failing input: an M7 pack declaring `C005` and `CASE_WHEN`, reference `SELECT CASE WHEN true THEN 1 END`, and a CASE refresher containing:

   ```sql
   COMMIT;
   SELECT CASE WHEN true THEN 1 END;
   BEGIN TRANSACTION;
   ```

   Pack validation succeeds and the gate returns no errors. Running the same lesson independently fails with `cannot commit - no transaction is active`. The gate’s own transaction makes the first statement succeed, and the lesson’s final `BEGIN` lets the gate’s cleanup succeed. Prevent lesson transaction commands from changing the conditions used to prove that the example runs.

4. **[P2] The hint leak test drops negative signs and misses a passing completion.** [tests/db/hint-leaks.mjs:12](/Users/vishal/teaching/badm554-taxi-crawler-v2/tests/db/hint-leaks.mjs:12)

   Concrete failing input: replace a floor-1 rung-3 outline with:

   ```sql
   SELECT * FROM trips_raw
   WHERE loaded_at = TIMESTAMP '2024-02-01 06:00:00'
     AND ___ = -1
   ```

   With C085 declared for the timestamp, this pack passes validation and the R3 gate. The number collector includes `1` but omits `-1`, even though it appears in the hint itself. Against the real floor data, the leak test reports **zero leaks**, with **51 variants running successfully**. Filling the blank with `-1` passes every floor-1 rule. Preserve numeric signs when building completions and add this example as a must-flag fixture.
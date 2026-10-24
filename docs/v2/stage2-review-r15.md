Three actionable defects remain in `543553c`. No repository files were edited, committed or pushed.

Both round 14 findings are fixed with the reviewer’s exact examples: `NULL IN (SELECT 1)` after a `LEFT JOIN` reports C083 and C085; `0 IN (SELECT 1)` reports C085; and both `&#x27;` and `&#039;` guide examples report undeclared C020.

All four suites ran one at a time and exited successfully:

| Suite | Passed | Skipped | Failed |
|---|---:|---:|---:|
| [Database](/tmp/r15-db.log) | 2,980 | 0 | 0 |
| [Stub browser — port 4885](/tmp/r15-stub.log) | 183 | 25 | 0 |
| [Real-engine browser — port 4886](/tmp/r15-real.log) | 203 | 5 | 0 |
| [Server](/tmp/r15-server.log) | 69 | 0 | 0 |

The [temporary coverage tests](/tmp/r15-review.test.mjs) passed all 36 checks, including untaught concepts in all seven requested text locations. Every visible guide code block matched the checker’s input across all floors, slides and Detail levels. Seven additional [reproduction and verification checks](/tmp/r15-defects.test.mjs) confirmed the defects below and their controls.

**FIX**

1. **[P2] HTML parsing removes required SQL from backticks in plain-text hints and messages.** [site/floors/concept-gate.mjs:57](/Users/vishal/teaching/badm554-taxi-crawler-v2/site/floors/concept-gate.mjs:57)

   Set floor 2’s `hints.columns[0].text` to:

   ```text
   Try `SELECT 1 WHERE 1<coalesce(NULL,1) AND 2>1`.
   ```

   The actual floor pack passes with **no errors and no C020 detection**. The checker treats `<coalesce(NULL,1) AND 2>` as an HTML tag and reads `SELECT 1 WHERE 11`. The running game displays the complete original query as plain text. The same false pass occurs in a checker message.

   Preserve the contents of backticks in plain-text fields instead of interpreting their SQL as HTML. [Complete fixture](/tmp/r15-defect-hint.json).

2. **[P2] Quotes inside JavaScript regular expressions can hide a marked checker message.** [tools/check-message-literals.mjs:56](/Users/vishal/teaching/badm554-taxi-crawler-v2/tools/check-message-literals.mjs:56)

   This is valid JavaScript:

   ```js
   const before = /'/;
   const hiddenHint = 'Try `SELECT coalesce(NULL, 1)`.';
   const after = /'/;
   ```

   Use `hiddenHint` for floor 2’s existing column-warning message. The message reader mistakes the quotes inside the regular expressions for string boundaries. It extracts `SELECT coalesce(NULL, 1)` without its backticks, so the gate treats it as prose and accepts the complete pack without detecting C020.

   I verified this in a [complete checker file](/tmp/r15-full-check.mjs). Removing the two regular-expression declarations makes the same message correctly fail as undeclared C020. The reader must recognize regular-expression boundaries or refuse forms it cannot read reliably.

3. **[P2] An altered join condition still earns confirmed orphan-check teaching credit.** [site/floors/concept-tree.mjs:432](/Users/vishal/teaching/badm554-taxi-crawler-v2/site/floors/concept-tree.mjs:432)

   In an M3 pack, declare C083 and map its refresher to:

   ```sql
   SELECT l.n
   FROM (VALUES (1), (2)) l(n)
   LEFT JOIN (VALUES (1)) r(m)
     ON l.n = r.m AND 1 = 2
   WHERE r.m IS NULL;
   ```

   The [complete fixture](/tmp/r15-defect-credit.json) satisfies the normal pack requirements and teaches C085 separately. The gate grants **confirmed C083 credit and accepts the pack without errors**.

   With only `ON l.n = r.m`, the example returns orphan **2**. Adding the contradictory condition returns **1 and 2**, including the key that has a match. The proof check finds an equality within the condition and ignores the additional condition that changes its meaning. Under R3b’s exact-shape rule, this should remain **possible** and earn no refresher credit.
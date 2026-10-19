# Floor 1 entry feedback (2026-10-19)

Created: 2026-10-19
Last Updated: 2026-10-19

Source: an MSBAi online learner Vishal invited to try the pilot (email to Vishal, 2026-10-19 6:44 AM
CDT; relayed de-identified by control). Spent 10 to 15 minutes on Floor 1 without finding the way in.

## What they hit, and where v2 stands

| What they hit | Already in v2 | Gap |
|---|---|---|
| 1. Not clear the answer had to be a saved table (`CREATE TABLE ... AS`); the course mostly used CTEs as "tables" | 1.3: every task ends "Use `CREATE OR REPLACE TABLE` to run your SQL again without a DROP." 2.0: Floor 1's first refresher shows `CREATE OR REPLACE TABLE ... AS` | Nothing says a CTE is not saved, or that the check reads only a saved table. The missing-table hint says only "Create a table named trips_clean on this floor." |
| 2. Every cue pointed to `DISTINCT`; `QUALIFY ROW_NUMBER() OVER (PARTITION BY <key> ORDER BY loaded_at DESC, row_id DESC) = 1` never occurred to them | 2.0: refresher "Keep a whole row from each group" (ROW_NUMBER, QUALIFY, tiny example). Guide section "Why DISTINCT finds nothing" | The DISTINCT section explains why it fails but not what to do instead. The check gives no pointer to the pattern when the learner's table still has 7,345 rows. |
| 3. Asked Claude for the answer after 10+ minutes with no direction | 3.2 and 4: Help setting (Nudge me, Walk me through it, Show me then explain). Pilot rule: whole answer after an attempt plus two direct requests | Check hints do not change with repeated failed checks; a stuck learner sees the same sentence each time. |

## Changes

A. **Saved table, stated up front** (extends 1.3, every floor, in the visible task):
   "The check reads a saved table. A `WITH` query (a CTE) disappears when the query ends, so finish
   with `CREATE OR REPLACE TABLE trips_clean AS ...`." The missing-table hint says the same, naming
   the floor's table. Each floor's refresher starts with a short "CTE versus saved table" example.

B. **From DISTINCT to the way forward** (extends 2.0 guide text and the Floor 1 check): the "Why
   DISTINCT finds nothing" section ends with the next move at Detail 1: "To keep one whole row per
   trip, number the rows inside each trip-key group and keep row 1," linking the refresher. When
   `trips_clean` has 7,345 rows (nothing removed), the row-count hint says the copies differ only in
   `row_id` and `loaded_at` and points to the same refresher. The task does not name the key columns
   (1.1 stays); the hint names the pattern, not the answer.

C. **A hint ladder** (new item 2.6, proposed; needs Vishal's yes): each floor pack lists hints per
   rule in rungs. Failed check 1 shows what is wrong; check 2 adds the idea to use and a refresher
   link; check 3 adds a query outline with blanks (for Floor 1, the `QUALIFY ROW_NUMBER() OVER
   (PARTITION BY ... ORDER BY ...) = 1` outline with the key left blank). Counted per floor in the
   browser, reset by Restart floor. Works with the tutor closed, which is how this learner met it.

Tests: A, the visible task on every floor contains the CTE sentence, and the missing-table hint names
the table; B, a 7,345-row `trips_clean` (for example `SELECT DISTINCT *`) gets the pattern hint and
the reference does not; C, three failed checks show rungs 1, 2 and 3 in order, Restart floor resets,
and rung 3 never contains the full key or a query that passes.

## Order

A and B are clarifications inside approved items and go in after 2.3's review (crew-codex-v2). C
waits for Vishal.

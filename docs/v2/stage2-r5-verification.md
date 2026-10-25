# Stage 2 R5: error help and query history

Created: 2026-10-24
Last Updated: 2026-10-24

Builder: crew-codex-v2. Branch: `v2/stage2`; starting commit: `8a310f3`.
Scope: approved plan 2.4 and 2.5, adapted to Scratch and Answer by R5.

## Finishing criteria

- Keep the original column error and add the relevant table columns. Scratch
  uses its current workspace; Answer uses the pristine given tables.
- Show the existing last-20 learner history with scratch/answer labels. Load
  restores full SQL to its original box without running it; Undo load restores
  that box's exact prior text.
- Include failed and cancelled runs, keep lists separate across floor switches,
  and clear only the restarted floor's list.
- Explain the additions on every floor at all three Detail levels, including
  with JavaScript off and at 375 px.
- Pass all four required suites under `caffeinate -dims`, retain the reviewed
  concept gate, and push one commit without merging, opening a PR or deploying.

## Acceptance coverage

`tests/db/stage2-r5.test.mjs` tests the real database. Each named scenario
below has an assertion on the returned columns, records or outcome.

| Requirement | Test coverage |
|---|---|
| Unknown `VendorID` in a plain query | Both Scratch and Answer; original error retained and `vendor_id` offered |
| Aliased join using `t.VendorID` | Both boxes; columns from both underlying tables |
| CTE | Both boxes; underlying given table, excluding the CTE alias |
| Learner-created table | The `notes` table and its `memo` column |
| Second statement fails | Create `notes`, then query the wrong column; one history entry and the created table survives |
| Scratch replaces `trips_raw` | Answer lists the original columns; Scratch lists only `workspace_only` |
| Scratch drops `trips_raw` | Answer still lists original columns; Scratch says the table does not exist |
| Quiet inspection | Open transaction remains open; Answer inspection and column help add no run or tutor record |
| Reference boundaries | Same-named CTEs, strings, comments and hidden qualified names do not cause unrelated column lists |
| History source labels | Explicit `scratch` and `answer` labels, with complete text kept apart from the short tutor record |
| Failed and cancelled runs | Both sources retain their SQL and error, with a null row count |
| Check floor column error | Pristine Answer columns without changing Scratch or either query record |
| Check a different loaded floor | Help uses the checked floor's given tables and leaves the active floor alone |
| Cancel during first Answer startup | The request is retained before execution begins and a cancelled Answer entry appears |

`tests/ui/stage2-r5.spec.js` uses the real game at desktop and 375 px:

- Starting with different unfinished text in each box, Load restores a query
  longer than 1,000 characters to its original box, including leading and trailing
  whitespace. The other box, Result and both query records stay unchanged.
  Undo load restores the exact prior text and returns focus to that box.
- Failed Scratch and cancelled Answer runs appear with their source labels.
  A round trip between floors preserves each list. Restart clears one floor's
  list while the other floor's list remains intact.
- Original errors and help remain visible after Scratch replacement and drop.
  Check floor shows help in its feedback while leaving Result and records alone.
  A subsequent successful run clears the old column help.
- With JavaScript disabled, each floor explains error help, Query history,
  Load, Undo load and Restart floor at all three Detail levels. The guide and
  game fit at 375 px.

Existing stage 0 tests continue to cover the 20-entry limit, history copies,
floor isolation, quiet inspection and the independent three-query tutor record.
No existing acceptance test was weakened or deleted.

The default quiet inspection still reads Scratch. Its Answer option reads only
that floor's given tables. Source labels were added to the full learner history;
the existing short Scratch record and the concept gate were left unchanged.

## Failures found and fixed

The initial new database cases failed because column help and explicit Scratch
history labels were missing. The first focused browser checks also failed on
the missing history controls and guide passages. These failures were observed
before their implementation.

The first complete R5 browser run passed eight cases and failed the history,
cancellation and floor-switch scenario at both desktop and 375 px. Cancel had
arrived while the first Answer engine was starting, before execution had its
cancellation control. A separate database reproduction confirmed that the click
was rejected. The request is now remembered during startup. The unchanged
browser scenario then passed at both widths, and a new database test confirms
that early cancellation is recorded.

An additional failing regression showed that help for a check on another loaded
floor used the active floor's columns. Help now follows the checked floor. The
focused database set passes all 18 cases; the focused browser set passes all 10.

## Verification results

All runs use `caffeinate -dims`.

| Suite | Passed | Skipped | Status |
|---|---:|---:|---|
| Database | 3,130 | 0 | Exit 0 |
| Stub browser, port 4883, `/tmp/pw-stub` | 185 | 33 | Exit 0 |
| Real-database browser, port 4884, `/tmp/pw-real` | 213 | 5 | Exit 0 |
| Server | 69 | 0 | Exit 0 |

All four final runs have zero failures and zero cancelled tests. The database
run completed in 18.8 minutes; the stub browser run in 3.7 minutes; the real
browser run in 9.8 minutes. The commands were:

```sh
# In tests/db:
caffeinate -dims npm test
# In tests/ui:
caffeinate -dims env PORT=4883 npx playwright test --output /tmp/pw-stub
caffeinate -dims env PORT=4884 DB_SITE=../../site npx playwright test --output /tmp/pw-real
# At the repository root:
caffeinate -dims node --test tests/server/*.test.js
```

The eight additional stub skips are the new database-backed R5 browser cases;
all eight pass against the real engine. The other skips are the existing
screen-specific and engine-specific exclusions.

The 375 px history and column-help screenshots were inspected. Long SQL wraps
inside a scrollable entry; column lists and controls fit within the page. The
full browser runs also retain the existing WebKit touch and layout checks.
No physical-device test was performed.

All 21 generated assets match their source packs and templates. The Rerun paths,
the protected shared files, and the concept gate are unchanged. The existing
untracked `tests/ui/node_modules` is excluded from the commit. No merge, PR,
deployment, Canvas write or message to another person was performed. Delivery
is limited to the authorized branch push.

`git diff --check` passes. The commit uses the requested title,
`v2 stage 2: R5 error help and query history`, the runbook's public author email,
and the `Agent: crew-codex-v2` trailer. No requested R5 work is deferred.

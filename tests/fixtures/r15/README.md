# Code review round 15 fixtures

Created: 2026-10-24
Last Updated: 2026-10-24

These are the complete, synthetic reviewer fixtures from `/tmp/r15-*`, retained
without changes to their module, declarations or refresher context. They contain
no learner records.

| File | Context and expected result |
|---|---|
| `hint.json` | Floor 2, M7, current floor declarations and lessons. The first columns hint contains literal backticks around `SELECT 1 WHERE 1<coalesce(NULL,1) AND 2>1`. Refuse undeclared C020. |
| `message.json` | Same floor/context; the SQL is in a checker message. Refuse undeclared C020. |
| `check.mjs` | Complete floor 2 checker; a column-warning message containing backtick-marked COALESCE sits between two regular expressions containing a quote. Parse the full file, collect that message, refuse undeclared C020 in the floor 2 pack. Do not import this fixture. |
| `credit.json` | M3 pack declaring C083/C085, a reference with the correct orphan join, a separate zero-comparison lesson, and an orphan lesson whose ON includes `AND 1=2`. Keep possible C083/C016; grant neither confirmed C083 nor C016. Refuse the C083 refresher claim. |

`R15 reproduction` tests in `tests/db/stage2-r3b.test.mjs` assert these corrected
outcomes. With `R15_BASELINE=543553c`, browser routes load the committed gate/tree
and a static data-module import loads the committed checker reader. The tests
remain current, so every reproduction must fail at the old commit and pass now:

```sh
caffeinate -dims env R15_BASELINE=543553c node --test \
  --test-name-pattern='R15 reproduction' tests/db/stage2-r3b.test.mjs
caffeinate -dims node --test \
  --test-name-pattern='R15 reproduction' tests/db/stage2-r3b.test.mjs
```

Additional R15 cases exercise all plain-text field families, parser refusals,
nested templates without execution, every ON conjunct, all seven confirmed
combination rules, result-changing wrappers, and exact passing controls.

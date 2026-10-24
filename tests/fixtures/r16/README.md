# Code review round 16 fixture

Created: 2026-10-24
Last Updated: 2026-10-24

`unicode-pack.json` is the complete synthetic M2 pack copied unchanged from
`/tmp/r16-unicode-pack.json`. It declares C034 and maps the window refresher to
two distinct DuckDB CTE names, "Ä" and "ä". The final query returns 7 from the
second CTE, discarding the first CTE's window output. Expected result: refuse
non-ASCII identifiers as unmodelled scope; grant no confirmed C034 credit.

`tests/db/stage2-r16.test.mjs` is the portable, corrected regression version of
`/tmp/r16-unicode.test.mjs`. It retains the native result of 7, the complete pack,
and the alpha/beta control that earns no window credit. It also verifies that
"Abc" matches abc, both as a query name and as a valid direct window-CTE proof.
The additional tests cover every identifier family, source location, function
lookup, name tracking, CTE reachability, native lexer losses, comments, data
values and actual Unicode separator/identifier boundaries.

All 65 tests fail by assertion against d2d61e0 and pass after this fix:

```sh
caffeinate -dims env R16_BASELINE=d2d61e0 node --test tests/db/stage2-r16.test.mjs
caffeinate -dims node --test tests/db/stage2-r16.test.mjs
```

Baseline mode serves the five committed gate modules directly from git through
browser routes. It does not change the checkout or weaken any assertions.
The fixture contains no learner records.

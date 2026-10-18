# R3 review round 2: skip link and grading reliability

Created: 2026-10-18
Last Updated: 2026-10-18

## Skip link

The link retains its native #guide-body destination for JavaScript-off reading.
With JavaScript on, its handler opens the Guide panel, focuses guide-body, scrolls
there, and restores the active #floorN address without changing floor or workspace.
It does not trigger a floor reload or clear either editor. It resets the Guide
scroll position and focuses without scrolling the opening paragraph behind the
sticky floor bar; the test checks that paragraph remains below the bar.

The new keyboard test activates the link from Floor 3's Game panel, at 1280 and
375 px. It checks visible Guide content, selected Guide tab, focus on guide-body,
#floor3 in the address, and the correct floor and saved Pipeline after reload.
Both widths failed before the handler was added; both then passed. The existing
JavaScript-off guide test is retained.

## Slow-check diagnosis and change

The unchanged browser test `run, repeat, next day and Check use separate state;
per-run results and server codes for all floors` waits up to five seconds for each
button to re-enable. The full seven-run floor-3 check was taking around three
seconds alone and could exceed that wait under concurrent database-test load.
Both widths timed out in the preceding concurrent run; a full run alone passed.

A Chrome CPU profile of the real check measured 2,842 ms before the change. Main
thread samples included 271 ms in exactNumber, 120 ms in fraction, 204 ms in Arrow
getters, and additional Arrow decoding and repeated row conversions. Each scenario
run was rebuilding and converting the same immutable reference data; the output
was also transferred and converted again just to omit load metadata.

The check now retains trusted expected counts, raw schema and exact row tokens
for the current day within that one isolated check. Day changes rebuild those
references. Every scenario run still resolves and checks the actual pipeline
objects, catalogs, original raw identity, raw contents, output types, counts,
provenance and contents afresh. No learner/pipeline snapshot or pass result is
cached, and nothing is reused between checks.

The output's already-exact tokens are projected for the days-1/2 comparison that
ignores load metadata, avoiding a second Arrow transfer/conversion. Integral
IEEE values convert directly to BigInt instead of allocating and reducing an
identical binary fraction. This retains the mathematical value even for large
integral doubles. Nonintegral numbers still take the exact binary-fraction path;
DECIMAL values still retain their own scale; only money rounds to cents.

The same profiled check then took 1,857 ms, about 35% less. A second run using the
committed profile tool measured 2,647 ms before and 1,867 ms after (29% less). Exact-number self time
fell to 56 ms and Arrow getter self time to 101 ms. This is one local headless
sample, not a timing promise. `node tests/db/rerun-check-profile.mjs d207404` and
`node tests/db/rerun-check-profile.mjs` reproduce the before/current comparison
using read-only baseline JavaScript and the planted data.

No acceptance test or timeout was changed. The extra database regression changes
a non-money raw value only on the second run, while retaining correct row/key
counts. It proves that reuse of trusted references cannot hide a later mutation:
the first run passes and day1-repeat fails both raw preservation and content.
Existing precision, object-resolution and correction/rebuild tests are retained.

## Verification

The targeted database run passed all 15 cases, including the new repeat-mutation
case and all prior precision/object-identity review cases. The required five
consecutive real-engine repetitions are run at each viewport (10 cases total),
while the full database suite also runs, to exercise the observed contention.
The test remains unchanged and keeps its original five-second individual waits.

The repeated unchanged real-engine test passed 10/10: five consecutive runs at
1280 px and five at 375 px, in 1.7 minutes, with the full database suite running
concurrently. Each complete test took 9.1-10.0 seconds across all three floors,
including workspace setup, manual queries and receipt calls. Every individual
five-second wait passed; no retry or increased wait limit was used.

| Gate | Result |
|---|---|
| Database | 259 passed, 0 failed |
| UI, stub database | 105 passed, 3 existing skips, 0 failed |
| UI, real database | 103 passed, 5 existing skips, 0 failed |
| Server | 57 passed, 0 failed |

The complete UI gates were rerun after the final sticky-bar scroll adjustment.
Manual keyboard activation was also inspected in a local synthetic app: the
address stayed #floor3, the mobile Guide opened, and its complete opening
paragraph remained visible below the floor bar. Screenshots were reviewed at
375 and 1280 px; the 375 px final scroll adjustment was inspected again. The only
console resource error was the existing missing favicon.ico; no app exception
occurred. Root
.r3-review-r2.md remains excluded. There is no deployment, paid model call or
live learner store in this verification.

# The Rerun: concept links in the floor guides (plan as approved)

Created: 2026-11-03
Last Updated: 2026-11-03

Vishal's request (2026-11-03): "put links in the game to the relevant concepts on the textbook on
github and the canvas pages, so students have context." Decisions (Vishal, 2026-11-03): Canvas
links for the in-person course (70436) only; build for The Rerun now and plan the same links for
v2.

## What changes

Each floor guide in `site/rerun/index.html` gets one "Background" paragraph after its task line.
It is static HTML, so it works with JavaScript off. Links open in a new tab (`target="_blank"
rel="noopener"`). The link text names the lesson, not "click here".

Textbook links go to the public site, `https://vishalsachdev.github.io/badm554-textbook/`. The
source repo on GitHub is private, so a repo link would return 404 to students. Anchors were
checked against the live pages on 2026-11-03.

| Floor | Textbook | Canvas (in-person, course 70436) |
|---|---|---|
| 1: Run it twice | M6I4 `modules/M6/I4/#the-double-load-the-silent-disaster`, `#the-fix-start-from-a-known-state` | Week 9: Tuesday Class (`pages/week-9-tuesday-class`) |
| 2: A new day | M6I4 `#why-it-happens-loads-that-only-add`; M3I3 `modules/M3/I3/#pattern-1-rank-rows-within-a-group` | Week 9: Tuesday Class |
| 3: Late corrections and rebuild | M6I4 `#rebuildability-the-raw-copy-pays-off`; M6I2 `modules/M6/I2/#extract-copy-faithfully-change-nothing`; M3I3 Pattern 1 | Week 9: Thursday Class (`pages/week-9-thursday-class`) |

Canvas links are labelled "In-person section". The Extra credit box gets one line that links the
textbook's Module 6 page and the in-person Week 9 overview
(`pages/week-9-overview-m6a-build-a-rebuildable-etl-pipeline`).

## Not changing

The tutor prompt, tools, server, floors, checks, and the extra credit due date (that waits on
Vishal's window dates).

## v2 (planned, not built)

Stage 3 (one page per floor) adds the same "Background" links to the v2 floor guides, mapped to
each v2 floor's concept. Recorded here; it goes into `docs/v2/plan-as-approved.md` when stage 3 is
planned.

## Gates

- Acceptance test: `tests/ui/rerun-links.spec.js` (Claude). Codex builds; all four suites green.
- Live deploy only with Vishal's yes. The Rerun stays closed; this changes static guide text only.

## Review focus

- An anchor that is renamed in the textbook later breaks silently: the test checks the hrefs, not
  the live pages.
- At 375 px, long link text must wrap, not scroll the page sideways.

# The Rerun: landing page at /rerun/start/ (plan as approved)

Created: 2026-11-03
Last Updated: 2026-11-03

Vishal (2026-11-03): "how about a landing page that introduces all this context?" Decisions
(Vishal, 2026-11-03): the page lives at `/rerun/start/` and the game stays at `/rerun/` (the
window is open and links are out); the page has a plain privacy note.

## Page: `site/rerun/start/index.html`

Static HTML and CSS only (works with JavaScript off), behind the same sign-in and open-time gate
as the game (`rerun/` static gate). Width 375 px with no horizontal scroll. Plain, short sentences.
Every fact below has a source; the page states nothing beyond them.

| Section (id) | Content | Source |
|---|---|---|
| intro | What The Rerun is: one pipeline script that must give the right answer every time it runs, on any day. Three floors. | `docs/rerun/floors.md` "The story" |
| data | Real NYC TLC yellow taxi trips from January 2024. 7,171 trips, delivered as three daily loads (day 1: 2,400 trips). `loaded_at` names the load, not the pickup date. A table of the 14 columns, one plain line each. One general sentence: the course added re-sends and corrections to teach pipelines; they are not TLC errors. Links: TLC trip record page; yellow taxi data dictionary (PDF). | `docs/rerun/floors.md`, `data/rerun/PLANTED.md` lines 6-7 and 53, TLC |
| concepts | Floors 1 to 3: task in one line, why it matters in one line, the same textbook and in-person Canvas links as the floor guides. | `docs/rerun/links-plan-as-approved.md` |
| tutor | What it sees (the guide, your pipeline and recent query results, its own copy of the raw data). 40 questions a day, 4 a minute; a failed answer does not use one. | `server/config.js`, `server/store.js`, #33 |
| privacy | Your tutor messages go to Anthropic's API to get an answer; no name or NetID is sent with them. Chats are kept on the course server under a random ID and deleted after final grades. "Forget me" deletes your chat. Do not type personal information. | `docs/decisions/2026-10-16-kickoff.md:42`, `server/README.md:92` |
| credit | 1% extra credit for all three floors plus one improvement issue. Codes due Fri 11-06, 11:59 PM CST. Improvement issue link. | guide |
| start | "Start the game" link to `/rerun/`. | |

**Never on the page:** which rows were re-sent or corrected, how many, or any detail from
`data/rerun/PLANTED.md` beyond the general sentence. That would give away the floors.

The game's guide bar gets one link, "About The Rerun", to `/rerun/start/`.

## Gates

- Acceptance test `tests/ui/rerun-start.spec.js` (Claude). Codex builds; all four suites green.
- Claude reviews every sentence against the sources above before merge.
- Live deploy with Vishal's yes. Then tell inperson the URL for Canvas.

## Review focus

- The static gate must serve `/rerun/start/` (directory index) to signed-in learners, and the
  opening notice rules must not change.
- Nothing in the data section hints at planted rows.

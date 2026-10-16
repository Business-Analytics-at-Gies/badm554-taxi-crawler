# Plan: taxi crawler weekend pilot

Created: 2026-10-16
Last Updated: 2026-10-16
Status: **Approved by Vishal, 2026-10-16 16:34 CDT** ("approved. closing 6:30 pm saturday . extra
credit 1%. They need to complete all three floors. deadline to paste 7 pm tomorrow."). Outcome
header is added at wrap-up.
Spec: `docs/design-spec.md`. Decisions: `docs/decisions/2026-10-16-kickoff.md`.

## Goal

In-person BADM 554 learners (both sections) test a three-floor taxi data-quality game with a
live tutor, as opt-in extra credit, on Sat 2026-10-17.

**Cost, in plain terms:** the $200 promo credit lasts through Saturday 2026-10-17, so it covers the
pilot day. The Console states the expiry in UTC: the end of Oct 17 UTC is **19:00 CDT Saturday**.
Play after that may bill your card (auto-reload is on). The most it can ever cost is the $150
workspace limit; the server stops the tutor at $140.

## Decisions Vishal owns

1. **Closing time: 18:30 CDT Saturday** (decided 16:34 CDT), inside the promo credit. The server
   enforces it: `TUTOR_CLOSES_AT=2026-10-17T23:30:00Z`.
2. **Extra credit: 1%, for all three floors** (decided 16:34 CDT). Codes must be pasted into the
   Canvas assignment by **19:00 CDT Saturday** (`2026-10-18T00:00:00Z`).
3. The wording of the announcement and the start-screen data notice (Claude drafts both; before step 9).
4. Whether the online section gets it later (default: not in this pilot).

## Steps (times are CDT, targets, not promises)

| # | By | Step | Who | Gate |
|---|---|---|---|---|
| 1 | Fri 17:30 | Approve this plan; decisions 1 and 2 | Vishal | his yes in chat |
| 2 | Fri 17:30 | Anthropic Console (API org): new workspace, $150 limit, key into `~/.taxi-crawler-anthropic-key` (not `~/.anthropic-promo-key`, which has no limit) | **Vishal** | file exists, `wc -c` only |
| 3 | Fri 17:30 | `az login`; Claude checks whether an Entra app can be registered | **Vishal** runs login | Entra or join code decided by 19:00 |
| 4 | Fri 17:30 | Freeze `docs/floors.md` (data schema, floor rules, valid and wrong solutions) and `docs/interfaces.md` (the three contracts below); write `docs/crew-runbook.md` | Claude | committed before any crew dispatch |
| 5 | Fri 17:30-21:00 | Build: three agents in parallel, one branch each (split below) | Crew | each package's tests pass |
| 6 | Fri 19:00 | One complete path on Azure: login → floor 1 → one tutor tool → receipt | Claude integrates | works on the live URL |
| 7 | Fri 21:00 | All three floors integrated; caps, ledger and receipts survive a restart. Feature freeze | Claude | the spec's Verification list |
| 8 | Fri 21:00-23:00 | Codex review of the server (a different session from the builder) until a round is clean; failure tests; Chrome and Safari at 1280px and 375px | Claude + Codex | no open P1/P2 |
| 9 | Fri 23:00 | A committed `_agent-inbox/` item in `~/teaching/badm554` for the inperson agent (owner of Canvas 70436): an unpublished extra-credit assignment (codes + three feedback questions) and an announcement in Vishal's voice, scheduled 30 minutes out; body edits through `~/.claude/scripts/canvas_inplace_edit.py` | Claude drafts; inperson makes the items | items exist, unpublished |
| 10 | Sat 08:00-09:00 | Vishal plays floor 1 with the tutor on the live site | **Vishal** | his OK |
| 11 | Sat 09:00 | Publish the assignment, then the announcement | inperson, on Vishal's "publish" for each | Vishal's yes per item |
| 12 | Sat | Watch spend and the request log; `TUTOR_OFF=1` on any stop condition | Claude + Vishal | spend under $140 |
| 13 | Sat close | The tutor refuses after `TUTOR_CLOSES_AT`; the game stays up | server | a refused request after the time |
| 14 | Sun | Verify codes and aggregate feedback in Codex Edu; write the outcome here | Codex Edu + Claude | outcome header |

**Postponement:** if step 7 is not done by Sat 10:00 CDT, the pilot moves to Week 11 and no
announcement goes out. All three floors ship, or none do.

## Build split (from the Codex review)

| Agent | Package and files it owns | Interface it supplies |
|---|---|---|
| Codex | `server/`: login (Entra headers or join code), sessions, `/api/tutor` (conversation, prompt, tools, step count), ledger, caps, shutdown, request log, `/api/receipt`, the grading verifier | session identity; tutor turn in and out; receipt; stable error codes |
| Devin | `data/`, `site/game/db/`: the extract and `PLANTED.md`, the DuckDB-WASM worker, the three floor checks, the tutor's copy and experiment isolation | dataset version and schema; query results; floor state; clear result; undo |
| Devin (second session, `crew-devin-ui`) | `site/learn/`, `site/game/ui/`: the guide rooms, the map, the SQL console, the tutor panel, browser tool dispatch, layout at 375px | `<page>` snapshot; tool execution and results; game-ready signal |

Claude owns `docs/interfaces.md`, shared config, integration on `main`, deployment and the final
checks. Models: the Codex builder on a frontier model at high effort (security code); both Devin
sessions on Claude Opus 5.5 (Cursor is dropped: free plan, Auto model only; Vishal, 2026-10-16); the review Codex session is separate from the builder. Every commit
carries an `Agent: <pane-name>` trailer. The crew gets synthetic test traffic only, never real
learner data.

## What learners see

The site (landing at `/learn/` with the tutor open), the start-screen data notice, three floors,
completion codes, one Canvas assignment and one announcement. Nothing else changes in Canvas.

## Stop conditions

Spend reaches $140; personal data shows up in a log; the tutor gives wrong SQL that a floor relies
on; the site is down for more than 30 minutes. Each one means `TUTOR_OFF=1` and a note to Vishal.

## Codex plan review (2026-10-16, before approval)

Opinion review on the personal Codex account (no learner data in the repo), thread
`01a1469d-bad9-7e93-9f98-9e6c8070e40f`. Each finding was checked against the spec before it was used.

| Finding | Disposition | Where it landed |
|---|---|---|
| P1 The $140 stop does not bound spend (charged after the fact; concurrency; cache tokens) | Accepted | spec 5: reserve first, persisted ledger, $1.50 per learner |
| P1 Easy Auth is authentication, not authorization; fallback caps can be reset | Accepted. Roster gate left out (it would put the roster on the server); cost caps bound outsiders instead, as an accepted risk | spec 5: login, fallback |
| P1 A pinned system prompt is not an abuse boundary while the browser sends the history | Accepted | spec 4: the server owns the conversation |
| P1 Learner-data separation needs operational rules | Accepted | spec 6: two stores, deletion, synthetic data for the crew |
| P2 Completion codes prove issuance, not ownership | Accepted | spec 6: receipts; decision 2 |
| P2 Floor rules ambiguous; counts alone pass wrong answers | Accepted | spec 2: `docs/floors.md` frozen first; spec 3: membership check |
| P2 "Under 3 MB" says nothing about browser reliability | Accepted | spec 3: 5,000-10,000 rows, single-threaded worker, timeouts |
| P2 The hand-written loop needs a reliability contract | Accepted | spec 4 |
| Schedule too optimistic; a thin path by 19:00; cut cab replay, zone shapes, streaming, notes | Accepted | steps above; spec 3 and 8 |
| P3 Credit-expiry contradiction | Already fixed: Codex read the docs during the control correction (`e16eae4`) | Goal |
| P3 One-floor fallback contradicts the brief | Accepted as a wording fix: no one-floor version; postpone instead | Postponement; decision log Scope row |
| P3 Review section promised but missing | Fixed | this section |

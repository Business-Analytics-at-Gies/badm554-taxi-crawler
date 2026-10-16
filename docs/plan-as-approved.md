# Plan: taxi crawler weekend pilot

Created: 2026-10-16
Last Updated: 2026-10-16
Status: **DRAFT. Not approved.** Vishal approves by saying so in chat; then this header changes to
"Approved <date time CDT>" and the build starts. Outcome header is added at wrap-up.
Spec: `docs/design-spec.md`. Decisions: `docs/decisions/2026-10-16-kickoff.md`.

## Goal

In-person BADM 554 learners (both sections) test a three-floor taxi data-quality game with a
live tutor, as opt-in extra credit, on Sat 2026-10-17, closing 23:59 CDT.

**Cost, in plain terms:** the $200 promo credit expires 2026-10-17 UTC, which is 19:00 CDT tonight
at worst and 19:00 CDT Saturday at best. Saturday play is therefore billed to your card (auto-reload
is on). The most it can cost is the $150 workspace limit; the server stops the tutor at $140.

## Review

Codex reviewed this plan and the spec before approval (Vishal, 2026-10-16); its findings and what changed are in the section "Codex plan review" below.

## Steps (times are CDT, targets, not promises)

| # | When | Step | Who | Gate |
|---|---|---|---|---|
| 1 | Fri 17:00 | Approve this plan | Vishal | his yes in chat |
| 2 | Fri 17:00 | Make the taxi extract from January 2024 yellow trips; count each kind of real dirt; plant what is missing; write `data/PLANTED.md` | Claude | counts pasted into the spec |
| 3 | Fri 17:00 | Anthropic Console (API org): new workspace, $150 spend limit, new key into `~/.taxi-crawler-anthropic-key` (not `~/.anthropic-promo-key`, which has no limit) | **Vishal** (Claude cannot create keys) | key file exists, `wc -c` only |
| 4 | Fri 17:30 | Azure: `az login`, then app service + Entra Easy Auth | **Vishal runs login**; Claude does the rest | login page works; if blocked at 19:00, switch to the join-code fallback |
| 5 | Fri 18:00 | Build `/learn/` (landing: map page + three floor rooms, tutor open by default) and the game window (map, console, three floors); the tutor | Crew: Codex, Devin, Cursor (Claude orchestrates and checks) | floor tests pass |
| 6 | Fri 18:00 | Build the proxy, caps, ledger, logs, completion codes (in parallel with 5) | Crew | proxy tests pass |
| 7 | Fri 21:30 | Codex review of server and proxy (a different Codex session from the builder); fix P1/P2 | Claude | a clean round |
| 8 | Fri 22:00 | Deploy; check the running site, not the deploy log | Claude | live URL serves this commit |
| 9 | Fri 22:30 or Sat 08:00 | Vishal plays floor 1 with the tutor | **Vishal** | his OK |
| 10 | after 9 | Canvas (in-person course 70436, owned by the inperson agent): Claude sends a committed `_agent-inbox/` item in `~/teaching/badm554` asking inperson to make an unpublished extra-credit assignment (codes + three feedback questions) and an announcement in Vishal's voice, scheduled 30 minutes out; body edits go through `~/.claude/scripts/canvas_inplace_edit.py` | Claude drafts the text; inperson makes the items | Vishal says "publish" to each one separately |
| 11 | Sat all day | Watch spend and the log; turn the tutor off if anything goes wrong | Claude + Vishal | spend under $140 |
| 12 | Sat 23:59 | Close: `TUTOR_OFF=1`; the game stays up without a tutor | Claude | tutor refuses requests |
| 13 | Sun | Verify codes with the script; aggregate feedback via Codex Edu; write the outcome here | Claude + Codex Edu | outcome header |

If step 8 slips past Sat 10:00, the pilot moves, and the announcement says so; it does not
shrink below floor 1.

## Decisions Vishal still owns

1. **Extra-credit points**, and whether they need one floor or all three.
2. The wording of the announcement and the start-screen data notice (Claude drafts both).
3. Whether the online section gets it later (default: not in this pilot).

## What learners see

The game URL, the start screen (what the game is, that tutor messages go to Anthropic, do not
type personal information), three floors, the tutor, completion codes, and a Canvas assignment
and announcement. Nothing else changes in Canvas.

## Stop conditions

Spend reaches $140; a learner reports personal data in a log; the tutor gives wrong SQL that a
floor relies on; the site is down for more than 30 minutes. Each one means `TUTOR_OFF=1` and a
note to Vishal.

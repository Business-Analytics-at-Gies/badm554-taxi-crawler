# BADM 554 Taxi Crawler

SQL games on NYC taxi data for BADM 554, with a live tutor. Start with `README.md`. The pilot is
Taxi Crawler (`/learn/`, closed 10-17). The second game is The Rerun (`/rerun/`). v2 of Taxi
Crawler is planned in `docs/v2/plan-as-approved.md`.

## Rules not in the code

- Live app: `dl-taxi-crawler` (Azure, resource group `DL_ResourceGroup_01`). A push to `main` does
  not deploy: the app has no linked source. Deploy only with Vishal's yes (zip of `server`, `site`,
  `data`; checksums of live files; `/healthz`).
- Builders: Codex builds and writes tests in a Herdr pane; Claude plans, writes acceptance tests,
  reviews, merges and deploys. Runbooks: `docs/v2/crew-runbook.md`, `docs/rerun/runbook.md`.
- Public repo: no student names, handles or NetIDs in commits, PRs or docs. Commit email is the
  GitHub noreply address. Tag GitHub comments `[Claude badm554-taxi-crawler]`.
- Student data: tutor and student-proxy traffic to Anthropic is a named exception
  (`docs/decisions/2026-10-16-kickoff.md:42`, `docs/student-api/design.md:86`). Any analysis of
  chats, feedback text, submissions or grades runs in Codex Edu; Claude reads aggregates only.
- Canvas posts for these games belong to the badm554 sessions (inperson, online), by inbox item.

## Current Focus

- [ ] The Rerun is live until Mon 10-26, 11:59 PM CDT. No change to `site/rerun/`, `server/rerun*`,
      `data/rerun/` or `tools/rerun/` before then.
- [ ] v2 stage 2 resumes under Vishal's 10-23 decisions (`docs/decisions/2026-10-23-v2-grading-and-gates.md`):
      grade the answer query, learning-graph gate, `CASE WHEN` refresher, hint ladder 2.6.
- [ ] #32: real-iPhone tap test on a non-live URL.
- [ ] Merge `v2/stage1` after 10-26, only after the 1.2 and 1.3 rework is green on all three suites.

## Roadmap

- [x] Pilot (10-16 to 10-17), 27 feedback issues triaged (`docs/triage-2026-10-23.md`)
- [x] The Rerun built, reviewed and deployed (10-18), open 10-23 to 10-26
- [x] v2 stage 0 merged; stage 1 built (held)
- [ ] v2 stage 1 rework (answer-query grading), then merge
- [ ] v2 stage 2 (2.0 to 2.6), then merge
- [ ] v2 stage 3 (one page per floor, Help controls), stage 4 (tutor gate), release checklist
- [ ] Stage 5 map (option 2, smaller, unless lens use is near zero) and stage 6 floors
- [ ] Student API proxy (`proxy` branch, P3 SHIP, release steps pending)
- [ ] Rename the repo to a general name after 10-26

## Session Log

### 2026-10-23

- Completed: issue triage; the merged `-rerun` and `-server` worktrees removed (`crew/server`
  kept, because `git branch -d` refuses: its patches are in main, but its merge commits are not).
  #6 closed as a duplicate, #20 closed, vague titles fixed. Vishal's stage 2 decisions recorded.
- Decisions: grade the answer query, not a saved table → the course does not teach saved tables
  (Vishal, 10-19 and 10-23).
- Next: stage 1 rework and stage 2 resume (Codex), #32 phone test URL, lens aggregates.

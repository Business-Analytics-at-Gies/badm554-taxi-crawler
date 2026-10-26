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
- [ ] v2 stage 2 (R0 to R5, under `docs/decisions/2026-10-23-v2-grading-and-gates.md`) is built and
      reviewed (r23 SHIP, 10-25), held on `v2/stage2`. Merge after Mon 10-26, green on all suites.
- [ ] #32: real-iPhone tap test on a non-live URL.
- [ ] Stage 1's 1.2 and 1.3 rework lives on `v2/stage2` and merges with it, not on its own
      (`docs/decisions/2026-10-23-v2-grading-and-gates.md`).

## Roadmap

- [x] Pilot (10-16 to 10-17), 27 feedback issues triaged (`docs/triage-2026-10-23.md`)
- [x] The Rerun built, reviewed and deployed (10-18), open 10-23 to 10-26
- [x] v2 stage 0 merged; stage 1 built (held)
- [ ] v2 stage 1 rework and stage 2 (2.0 to 2.6): built and reviewed on `v2/stage2` (10-25); merge after 10-26
- [ ] v2 stage 3 (one page per floor, Help controls), stage 4 (tutor gate), release checklist
- [ ] Stage 5 map (option 2, smaller, unless lens use is near zero) and stage 6 floors
- [ ] Student API proxy (`proxy` branch, P3 SHIP, release steps pending)
- [ ] Rename the repo to a general name after 10-26

## Session Log

### 2026-10-25

- Completed: v2 stage 2 resume R0 to R5 built by Codex and reviewed to SHIP (R3b spec in 18
  rounds; code reviews r9 to r23; last SHIP at `191eb14`), held on `v2/stage2` at `f298284`.
  Pilot lens use counted (0 calls). R5 error help scope closed in the spec. Run log:
  `docs/v2/crew-runbook.md`.
- Open for Vishal (via control): (1) Tailscale Serve admin click for the #32 phone test (server
  in pane w5Y:p2, port 3754, worktree `-phonetest`); (2) map: switch to option 3, since lens use
  was 0?; (3) confirm the merge route (stage 1 rework merges with `v2/stage2` after 10-26);
  (4) arithmetic and CAST have no learning-graph concept and pass as untaught overrides: add
  concepts or keep the overrides?; (5) delete the auto memory `project-anthropic-data-exception`
  (it repeats lines 16-18 here)?
- Next: after Mon 10-26, merge `v2/stage2` (control merges) once green on all four suites;
  #32 tap test; issue comments and closures wait for control; stages 3 and 4.

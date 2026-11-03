# Session archive

Older session log entries moved out of `CLAUDE.md`.

### 2026-11-02

- Completed: #33 diagnosed. The live API key returns 401; the same key settled all 175 pilot
  calls through 10-17; all 6 Rerun calls on 10-24 failed. With that key under a test window, the old
  code reproduces the fault (40 to 37). Codex built the fix (failed calls refund the question but
  still count for the rate limit, rejected calls hold no money, clear message, logged
  `tutor_model_rejected`/`tutor_model_failed`); one regression caught in review; independent
  review SHIP; server 84/84. Status comments on #33 (claimed, blocked).
- 11-03: new key in; the old code also works with it, so the key was the only cause. Merged
  `7f3590b`, new key on Azure, deployed (6 files match by checksum, /healthz 200, still closed).
  Final #33 comment and inperson inbox note posted.

### 2026-10-25

- Completed: v2 stage 2 resume R0 to R5 built by Codex and reviewed to SHIP (R3b spec in 18
  rounds; code reviews r9 to r23; last SHIP at `191eb14`), held on `v2/stage2` at `f298284`.
  Pilot lens use counted (0 calls). R5 error help scope closed in the spec. Run log:
  `docs/v2/crew-runbook.md`.
- Open for Vishal (via control): (1) Tailscale Serve admin click for the #32 phone test;
  (2) map: switch to option 3, since lens use was 0?; (3) confirm the merge route; (4) arithmetic
  and CAST: add concepts or keep the overrides?; (5) delete the auto memory
  `project-anthropic-data-exception`?

### 2026-10-23

- Completed: issue triage; the merged `-rerun` and `-server` worktrees removed (`crew/server`
  kept, because `git branch -d` refuses: its patches are in main, but its merge commits are not).
  #6 closed as a duplicate, #20 closed, vague titles fixed. Vishal's stage 2 decisions recorded.
- Decisions: grade the answer query, not a saved table → the course does not teach saved tables
  (Vishal, 10-19 and 10-23).
- Next: stage 1 rework and stage 2 resume (Codex), #32 phone test URL, lens aggregates.

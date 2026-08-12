# Orchestrator Rules — Example App Test Run

This is a **test run** of the PM → UX → Dev → QA pipeline on a small example app,
before it's pointed at the real STR PMS project. Goal: validate the handoff
mechanics, not ship a polished product.

## Example app for this run
A URL shortener with click analytics:
- POST a long URL → get a short code
- GET /:code → redirect + log a click event
- GET /:code/stats → click count, referrers, timestamps

Small, but forces real decisions: short-code collision handling, invalid/expired
link behavior, concurrent write safety on the click counter.

## Roles
See `/agents/pm.md`, `/agents/ux.md`, `/agents/dev.md`, `/agents/qa.md`.

## Handoff sequence
1. PM writes spec + acceptance criteria → opens a GitHub issue.
2. UX reviews the spec, comments with edge cases. PM revises if UX flags a gap.
   Loop until both agree — do not proceed until UX has explicitly signed off
   in the issue thread.
3. QA writes tests against the acceptance criteria **before** looking at any
   implementation code.
4. Dev implements on a feature branch, opens a PR.
5. QA runs its tests against the PR. Fail → bug report comment, Dev iterates.
   Pass → QA approves.
6. CI (GitHub Actions) must be green.
7. **CHECKPOINT — stop here and wait for human PR approval before merging to main.**

## Checkpoints (the only two manual stops)
- **Checkpoint 1:** human approves PM's spec before Dev starts.
- **Checkpoint 2:** human approves the PR before merge to `main`.
Everything else in the sequence above runs unattended.

## Ground rules for all agents
- Every output goes into a GitHub issue, PR, or PR comment — not just chat.
  If it isn't written to GitHub, the next agent can't see it.
- Disagree explicitly. If UX thinks the PM spec is missing a case, or QA thinks
  Dev's fix doesn't cover the bug report, say so in the thread and block
  progression — don't silently proceed.
- QA is blind to implementation until tests are written. Do not read Dev's
  branch before drafting the test suite.

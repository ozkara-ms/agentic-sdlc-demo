---
name: deploy
description: Build the unit's container, smoke-test the running service, and gate on the deploy workflow's RUN CONCLUSION (not just /healthz). Wraps checks/scripts/smoke-check.mjs + checks/lib/run-status.mjs.
wraps:
  - checks/scripts/smoke-check.mjs
  - checks/lib/run-status.mjs
owner: deployment
---

# Skill: deploy

> The deployment agent invokes this **after** fan-in/integration to take an
> integrated change to its target and report a trustworthy go/no-go. A green
> `/healthz` is NOT a green pipeline (the Loop-3 lesson).

## When to invoke
After the integration unit is green and the change is approved for release — local
build + dry-run in Phase 1, real target deploy in Phase 2 (human-gated).

## Inputs
- The container build context (`Dockerfile`) and target platform (`linux/amd64`).
- The smoke probe path + expected status (e.g. `/healthz` 200, or a `responses`
  host turn). The probe is **parameterized** — not hardcoded to `/healthz`.
- For Phase 2: the deploy workflow name + the deployed SHA.

## Procedure
1. **Build for the target arch:**
   `docker build --platform linux/amd64 -t <image>:dev .` — a build failure is a
   hard **NO-GO**.
2. **Start the container and smoke it:**
   ```bash
   docker run --rm -p <port>:<port> <image>:dev &
   node <HARNESS_ROOT>/checks/scripts/smoke-check.mjs --url http://localhost:<port><probe> --expect 200
   ```
   For a responses-host service, probe a real turn, not just liveness.
3. **Gate on the RUN CONCLUSION (Phase 2 — G1/G3):** read the deploy workflow's
   Actions run for the deployed SHA and treat anything other than
   `success`/`neutral` as **NO-GO**:
   ```bash
   node <HARNESS_ROOT>/checks/lib/run-status.mjs   # pure oracle
   # live: orchestrator/cli.mjs --watch --repo <o/n> --sha <sha> --workflow deploy
   ```
4. **Report health + run-conclusion + go/no-go**; keep **rollback** ready and
   automatic on failure.

## Honesty rules (hard)
- Never deploy on a red gate or an unapproved release.
- **Never report go on a red Actions run even if `/healthz` is green.**
- A container that did not actually start, or a smoke that was skipped, is **NO-GO** —
  never "assumed green".
- Never deploy outside the Environment's protection rules (reviewers / wait timers).

## Polyglot / target-agnostic
The build + smoke + run-status logic is content-general. The probe path, port, and
deploy command come from the target's manifest (`agent.yaml` for a Foundry hosted
agent; a deploy workflow for Container Apps). This skill orchestrates; the target
declares the specifics.

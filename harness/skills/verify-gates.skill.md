---
name: verify-gates
description: Confirm GitHub-native enforcement is actually LIVE on the target repo before any unit work — gate workflows present, required status checks set, branch protection/ruleset active, CODEOWNERS present — returning READY or NOT-READY with the specific gaps. EXAMPLE skill.
owner: deployment
wraps:
  - deploy/github/enforce-protections.ps1
---

# Skill: verify-gates

> The orchestrator gates on this **before** materializing work issues (`plan-to-issues`) and before
> dispatching any unit. It answers one question honestly: *will every unit PR actually be gated, or
> would it merge ungated?* This is the check that would have caught the first run's F6 gap (15 PRs
> merged with 0 checks / 0 reviews / no workflows).

## When to invoke
- At the end of project-zero, right after the deployment agent **wires** enforcement
  (`enforce-protections.ps1` + vendored workflows + CODEOWNERS) — to PROVE it took.
- Again as a **precondition of `plan-to-issues`** and of the first dispatch — never create/assign work
  issues against a repo whose gates aren't live.

## Inputs
- `github.org/repo`, `defaultBranch`, and `requiredChecks[]` from `.harness/project.json`.

## Procedure (read-only checks; report READY only if ALL pass)
1. **Gate workflows present** in the repo:
   `gh api repos/<org>/<repo>/contents/.github/workflows` → must include the verification + security
   workflows (e.g. `tests-and-evals.yml`, `security-gate.yml`). Missing → NOT-READY.
2. **Branch protection / ruleset active** on `defaultBranch`:
   `gh api repos/<org>/<repo>/rulesets` (or `…/branches/<b>/protection`) → a rule must require a PR +
   approving review. HTTP 404 / no active rule → NOT-READY.
3. **Required status checks set** = the plan's `requiredChecks`:
   confirm the ruleset's `required_status_checks` contains each name in `project.json.requiredChecks`
   (e.g. `Tests & Evals`, `Security Gate`). Any missing → NOT-READY (those checks won't block merge).
4. **CODEOWNERS present** (`.github/CODEOWNERS` or root `CODEOWNERS`) AND code-owner review required in
   the ruleset → else the code-review gate is unenforceable. Missing → NOT-READY.
5. **Check names have registered** — the required check names must have appeared on a recent PR's
   check-runs (a never-run name can't gate; `enforce-protections.ps1` guards this). Not seen → WARN +
   NOT-READY until a throwaway PR registers them.
6. **Mergeability sanity — no self-approval deadlock (QF7).** If the ruleset requires an approving review +
   CODEOWNERS review, confirm the gate is *satisfiable* by someone OTHER than the PR author. Failure mode:
   every harness session runs `gh` under the **same human identity**, so unit PRs are authored by that human;
   if the **only CODEOWNER is that same identity** AND `bypass_actors` is empty, GitHub forbids self-approval
   → green PRs become **unmergeable** and the run hard-blocks at the merge gate. Check:
   `gh api repos/<org>/<repo>/rulesets/<id> --jq .bypass_actors` (empty?) + the `CODEOWNERS` owners vs the
   PR-authoring identity. If the only approver == the author and there's no bypass → **WARN (deadlock risk)**:
   recommend one of (a) a second reviewer account, (b) add a repo-admin bypass actor, or (c) implement via the
   **Copilot cloud agent** (PR author ≠ the human, so the human CODEOWNER can approve — the preferred fix).
7. **(Recommended) prove the gate bites** — confirm a deliberately-failing PR is blocked and a clean
   one merges (the live proof; `enforce-protections.ps1` step d). Record the evidence.

## Output
- **READY** — every gate above is live; safe to create work issues + dispatch. Record the evidence
  (commands + results) for the audit trail.
- **NOT-READY** — the explicit list of missing gates + the exact remediation (which workflow to vendor,
  which protection to set, run `enforce-protections.ps1 -Repo <org>/<repo> -Reviewer <human>`), handed
  back to the **deployment** agent. The orchestrator must NOT proceed to issues/dispatch until READY (or
  explicitly label the run **layered-only (unenforced)** and say so).

## Honesty rules (hard)
- **Never report READY unless the named required checks + branch protection + CODEOWNERS are all
  actually configured** — "the workflow file exists" is NOT the same as "the check is required".
- A required check name that has never run does not gate anything — treat as NOT-READY.
- If you cannot verify (no access, API error), report NOT-READY/unknown — never assume green.

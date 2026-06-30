---
name: run-tests
description: Run a work unit's required tests + trajectory/eval gates on the REAL diff, and report an honest pass/fail. Wraps checks/scripts/trajectory-check.mjs + eval-rubric.mjs.
wraps:
  - checks/scripts/trajectory-check.mjs
  - checks/scripts/eval-rubric.mjs
owner: quality-test
---

# Skill: run-tests

> The quality-test agent invokes this to prove a unit does what its Issue asked —
> **deterministically (tests)** and, where applicable, **non-deterministically (evals)**.
> A green demo is not done; a green required test is.

## When to invoke
After a dev-fleet agent reports a unit's implementation is ready, and before the
unit is allowed to land. Once per unit PR (and on every push to it).

## Inputs (from the unit's `.harness/plan.json` entry or `.agent/unit.json`)
- `requiredTest` — the exact command to run (e.g. `pytest tests/test_agent.py`
  for Python, `npm run test:unit` for Node).
- `paths` / `declaredPaths` — the unit's owned files.
- `changedPaths` — derive from `git diff --name-only <base>...HEAD` in the target repo.

## Procedure
1. **Run the unit's `requiredTest` on the real working tree.** Capture exit code +
   the full summary line. Non-zero exit, collection errors, or "0 tests ran" =
   **FAIL** (never report green on an empty run).
2. **Trajectory gate** — confirm the change touched the declared files AND added
   the required test:
   ```bash
   node <HARNESS_ROOT>/checks/scripts/trajectory-check.mjs \
     --declared <paths...> --changed <changedPaths...> --required-test <test-file>
   ```
3. **Output eval (when the unit declares an eval rubric)** — grade the behavior,
   not just its presence (e.g. the request-contract / rate-limit rubrics under
   `checks/scripts/rubrics/`). Run the unit's declared rubric variant.
4. **Report** each result with its enforcement label (🟦 required CI job locally /
   🟦 layered eval). Tests + evals must BOTH be green for the unit to pass.

## Honesty rules (hard)
- Never pass on tests alone when the unit declares an eval — **evals are required**.
- Never weaken, skip, `xfail`, or delete a check to force green.
- A test that is `skipped`/`not applicable` (e.g. a container test with no Docker
  daemon) is **not** a pass — report it as skipped and treat the unit as **not done**.
- Report only coverage you actually ran.

## Polyglot
`requiredTest` is whatever the unit declares — `pytest …`, `npm test …`, `go test …`.
This skill runs that command verbatim; the language-specific runner is the unit's
choice, not this skill's. The trajectory check is content-general (paths + a test file).

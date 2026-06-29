# `harness/checks/` — real verification logic (Tier-1 runnable, Tier-2 enforceable)

This directory replaces the asset's EXAMPLE `echo` placeholders with **real, runnable**
verification. Everything here is plain Node (no extra deps) so the Tier-1 validator
(`_internal/harness-selftest/validate/`) can call it directly **with no GitHub**, and the same logic becomes
**required status checks** once instantiated into the dedicated Tier-2 repo.

## Layout
```
harness/checks/
  workflows/
    tests-and-evals.yml   # Tests (unit/e2e) + Evals (trajectory + rubric) + Path-scope
    security-gate.yml     # dependency-review + CodeQL + pin/slopsquat check
  scripts/
    eval-rubric.mjs       # deterministic 429 + Retry-After acceptance eval (the rate-limit story)
    trajectory-check.mjs  # did the change touch declared files + add the required test?
    path-scope-check.mjs  # did the change stay inside the unit's declared paths?
    pin-check.mjs         # supply-chain: slopsquat + mutable-spec + lockfile coverage
    lm-judge.mjs          # OPTIONAL LM-judge stand-in; no-ops without a model token
```

## Enforcement classification (honest labels)
| Check | Job / script | Enforcement |
|---|---|---|
| Unit / e2e tests | `tests` job → `npm run test:unit` / `test:e2e` | 🟦 required CI job (T2) / 🟦 local assertion (T1) |
| Trajectory eval | `evals` job → `trajectory-check.mjs` | 🟦 layered eval (pattern, not a GitHub product) |
| Output rubric (429 + Retry-After) | `evals` job → `eval-rubric.mjs` | 🟦 layered eval — the Quality/Test **negative test** lives here |
| LM-judge | `evals` job → `lm-judge.mjs` | 🟨 advisory / **non-required** (skips on fork PRs) |
| Path-scope | `path-scope` job → `path-scope-check.mjs` | 🟦 custom required job — **not** a GitHub primitive |
| Dependency review | `dependency-review` job | 🟩 native GHAS |
| CodeQL | `codeql` job | 🟩 native GHAS |
| Pin / slopsquat | `supply-chain-check` job → `pin-check.mjs` | 🟦 custom required job |

> The dispatcher's plan-approval gate (`_internal/harness-selftest/orchestrator/`) is **separate** layered
> orchestration (🟦) — GitHub does not enforce "plan approval"; see that folder's README.

## Script contracts (callable locally, no GitHub)
```bash
# Output rubric — grade a candidate limiter mounted onto the app factory.
node harness/checks/scripts/eval-rubric.mjs --app _internal/harness-selftest/sample-app/dist/app.js \
  --variant _internal/harness-selftest/scenarios/s1-rate-limit/fixtures/quality-test/good.mjs --max 3        # PASS (exit 0)
node harness/checks/scripts/eval-rubric.mjs --app _internal/harness-selftest/sample-app/dist/app.js \
  --variant _internal/harness-selftest/scenarios/s1-rate-limit/fixtures/quality-test/no-429.mjs --max 3      # FAIL (exit 1)

# Trajectory + path-scope — feed declared/changed paths directly (flags), or run the
# whole seeded matrix via the Tier-1 validator (below), which adapts the fixtures for you.
node harness/checks/scripts/trajectory-check.mjs \
  --declared _internal/harness-selftest/sample-app/src/middleware/ \
  --changed _internal/harness-selftest/sample-app/src/middleware/rateLimit.ts \
  --required-test _internal/harness-selftest/sample-app/test/unit/middleware/rateLimit.test.ts   # FAIL (no test)
node harness/checks/scripts/path-scope-check.mjs \
  --declared _internal/harness-selftest/sample-app/src/middleware/ \
  --changed _internal/harness-selftest/sample-app/src/middleware/rateLimit.ts,_internal/harness-selftest/sample-app/src/config.ts  # FAIL (stray)

# Supply-chain — grade a package.json (the synthetic Security fixture is RED).
node harness/checks/scripts/pin-check.mjs --package _internal/harness-selftest/sample-app/package.json                  # PASS
node harness/checks/scripts/pin-check.mjs --package _internal/harness-selftest/scenarios/s1-rate-limit/fixtures/security/bad-deps-package.json  # FAIL
```

## Tier-1 validator — the whole seeded matrix in one command
```bash
node _internal/harness-selftest/validate/run.mjs           # human-readable matrix, exit 0 only if all correct
node _internal/harness-selftest/validate/run.mjs --json    # machine-readable
node _internal/harness-selftest/validate/run.mjs --filter security-compliance   # one agent
```
`_internal/harness-selftest/validate/run.mjs` loads every `_internal/harness-selftest/scenarios/s1-rate-limit/fixtures/<agent>/*.json` (CONTRACT §4 schema),
routes each to its **driver** (`plan-lint`/`path-scope`/`trajectory`/`eval-rubric`/`pin-check`/
`doc-coupling`/`smoke`/`dispatch`), and asserts the **actual** outcome equals the fixture's
**expected** outcome. A negative fixture that is NOT caught is reported as **THEATER** and the
suite exits 1. Each row is printed with its enforcement label (🟩/🟦/🟨/⛔) so nothing reads as
a stronger guarantee than it is. See `_internal/harness-selftest/validate/README.md`.
The eval-rubric variant contract: a `.mjs` that **default-exports an Express
`RequestHandler`** limiting to `Number(process.env.RATE_LIMIT_MAX)` per
`Number(process.env.RATE_LIMIT_WINDOW_MS)` (the rubric sets these envs). Mounted via the
sample app's `createApp({ extraMiddleware })` factory — no edits to app source needed.

## The `.agent/unit.json` scope convention (Tier-2 PRs)
A real fleet PR can't know its lane from thin air, so the dev agent commits a tiny
descriptor on its branch and the workflow reads it:
```json
{ "unit": "U1", "declaredPaths": ["src/middleware/**", "test/unit/rateLimit.test.ts"],
  "requiredTest": "test/unit/rateLimit.test.ts" }
```
`trajectory-check` and `path-scope-check` derive `changedPaths` from
`git diff --name-only origin/<base>...HEAD` and grade against this file. Tier-1 fixtures
mirror the same JSON shape so the *same scripts* run in both tiers.

## Tier-2 instantiation mapping (D7)
The dedicated repo = the sample app at **root** + the harness. Copy:
```
_internal/harness-selftest/sample-app/*          ->  <repo root>            (app, tests, package.json, lockfile)
harness/checks/scripts/*          ->  <repo root>/ci/scripts/
harness/workflows/*.yml    ->  <repo root>/.github/workflows/
docs/.../harness/AGENTS.md  ->  <repo root>/AGENTS.md
docs/.../harness/agents/*   ->  <repo root>/.github/agents/   (etc.)
```
Then trigger one run so the check-run names register, and make these REQUIRED in the ruleset:
`Tests (unit)`, `Tests (e2e)`, `Evals (trajectory + rubric)`, `Path-scope (fleet lane check)`,
`Dependency review (supply-chain)`, `CodeQL (code scanning)`,
`Hallucinated-dependency / slopsquatting check`.

> Branch target is **`master`** (this org's default), not `main`. The EXAMPLE harness YAMLs
> under `docs/.../harness/workflows/` keep `main` as the generic default; these runnable
> copies retarget to `master`.

# `DEMO_SCRIPT.md` — presenter golden path

> The **one story**, threaded through **every** agent/gate, with the exact command to run at each stage,
> the artifact it produces, and the **adversarial negative** to show being *caught*. **Acts 0–13 are the
> Tier-1 deterministic spine** — fully runnable offline, the anti-theater proof and the presenter's
> reliable fallback. The **[LIVE RUN](#live-run--the-real-tier-2--tier-3-path-on-azure)** section at the
> bottom is the real GitHub + Azure path (issue-native planning, `@copilot` fleet, required checks, live
> ACA deploy + both rollback variants), with its **load-bearing run order**.
>
> **The whole T1 thing in one command:** `node demos/validate/run.mjs` runs every gate below and exits
> non-zero if any negative slips through. The acts below let you narrate it stage by stage.

## The story (frozen)
> *"Add rate limiting to the URL-shortener API so a single client can't exhaust the service."*

Decomposes into **U1** limiter middleware ‖ **U2** config surface ‖ **U3** docs (all parallel-safe) and
**U4** integration test (ordered — `dependsOn: [U1, U2]`).

## Honesty legend
🟩 native GitHub · 🟦 our CI job / local assertion · 🟨 advisory (non-blocking) · ⛔ external (coding-agent / human).
The dispatcher's plan-approved gate is **layered orchestration, never native pre-code enforcement.**

## Pre-flight (once)
```bash
npm --prefix demos/sample-app ci
npm --prefix demos/sample-app run build
npm --prefix demos/sample-app test     # 15 unit+e2e tests green — the "before" app works (no limiting yet)
```

---

## Act 0 — Intent
**Say:** a single product intent arrives. Everything downstream is traceable to it.
**Artifact:** [`orchestrator/example-plan.json`](./orchestrator/example-plan.json) `.intent`.

## Act 1 — Planning (🟦 local assertion)
**Say:** the planner decomposes the intent into a DAG; the dependent integration unit must be marked
**ordered**, not parallel.
**Run:**
```bash
node demos/validate/run.mjs --filter planning
```
**Show:** the positive plan passes; the **negative** — an inherently-ordered unit (Redis store → limiter)
mislabeled `parallelSafe: true` — is **caught** (`ordered-unit-marked-parallel`).

## Act 2 — Rubber-Duck gate (🟦 local assertion)
**Say:** before any code, a devil's-advocate pass stress-tests the plan.
**Run:**
```bash
node demos/ci/scripts/plan-lint.mjs --input demos/fixtures/rubber-duck/negative-hidden-dependency.json
node demos/validate/run.mjs --filter rubber-duck
```
**Show:** the flawed plan (two "parallel-safe" units secretly share a limiter store **and** the
integration test is mislabeled parallel) is **caught** on two signals
(`parallel-units-share-path`, `integration-marked-parallel`). The corrected plan passes.

## Act 3 — Human approval ⛔ (native in T2)
**Say:** a human applies the **`plan-approved`** label. GitHub does not enforce "plan approval" — this is
a human gate the dispatcher *chooses* to honour. *(T1: informational; T2: a label-conditioned workflow.)*

## Act 4 — Dispatch / fan-out (🟦 orchestration, NOT native)
**Say:** the dispatcher fans out only the **approved** plan, sends the 3 parallel-safe units as one wave,
and **holds U4** until U1+U2 land.
**Run:**
```bash
node demos/orchestrator/cli.mjs --plan demos/orchestrator/example-plan.json          # dispatch U1,U2,U3 · hold U4
node demos/orchestrator/cli.mjs --plan demos/orchestrator/example-plan.json --landed U1,U2,U3   # now U4 dispatches
node demos/validate/run.mjs --filter orchestrator
```
**Show:** the wave decision; then the **negative** — an unapproved plan → the dispatcher **refuses to
fan out anything** (`refused-unapproved`, exit 1). *(In T3, add `--assign --repo … --issues …` to assign
each unit's issue to `@copilot`. ⛔)*

## Act 5 — Dev fleet ×3 (🟦 required CI job)
**Say:** three dev agents open three PRs, each scoped to its unit. Two custom checks keep them honest.
**Run:**
```bash
node demos/validate/run.mjs --filter dev-fleet
```
**Show:** **path-scope** — a PR straying into another unit's file (`src/config.ts`) is **caught**
(`path-violation`); **trajectory** — a PR that ships the feature but **no test** is **caught**
(`missing-required-test`). The in-lane, test-included PRs pass.

## Act 6 — Quality / Test evals (🟦 required CI job)
**Say:** tests alone aren't enough — an **output rubric** grades real behaviour (429 at the threshold +
a numeric `Retry-After`).
**Run:**
```bash
node demos/ci/scripts/eval-rubric.mjs --app demos/sample-app/dist/app.js \
  --variant demos/fixtures/quality-test/good.mjs               # PASS 3/3
node demos/ci/scripts/eval-rubric.mjs --app demos/sample-app/dist/app.js \
  --variant demos/fixtures/quality-test/no-429.mjs             # FAIL — limits nothing
node demos/validate/run.mjs --filter quality-test
```
**Show:** the good limiter scores 3/3; the **no-429** impl (passes unit tests, limits nothing) and the
**missing-Retry-After** impl both turn the evals gate **RED**.

## Act 7 — Security / Compliance (🟦 custom job + 🟩 GHAS in T2)
**Say:** every PR's dependencies are screened for hallucinated / unpinned packages. *(Decoupled synthetic
fixture — supply-chain risk is orthogonal to the rate-limit story.)*
**Run:**
```bash
node demos/ci/scripts/pin-check.mjs --package demos/sample-app/package.json                  # PASS
node demos/ci/scripts/pin-check.mjs --package demos/fixtures/security/bad-deps-package.json   # FAIL
node demos/validate/run.mjs --filter security-compliance
```
**Show:** the real app (caret ranges + committed lockfile = the *secure* pinning pattern) is green; the
synthetic manifest (`expresss`/`axioss` typosquats, `*`/`latest` mutable specs, no lockfile) is **caught**.
*(In T2, CodeQL + dependency-review add the 🟩 native half over the injectable sink.)*

## Act 8 — Code Review (🟨 advisory; 🟩 CODEOWNERS blocks in T2)
**Say:** the reviewer flags architecture changes that ship without docs — advisory, not a hard block.
**Run:**
```bash
node demos/validate/run.mjs --filter code-review
```
**Show:** an arch change to `app.ts` with **no docs update** is **flagged** (`missing-doc-update`); the
docs-updated PR is clear. The *merge* block in T2 is a required **CODEOWNERS** review.

## Act 9 — Human approves PRs ⛔ (native in T2)
**Say:** required reviewers approve. *(T2: ruleset-required review + CODEOWNERS.)*

## Act 10 — Merge queue (🟩 native, T2)
**Say:** the merge queue integrates the parallel PRs in order; once U1+U2 land, **U4** (integration test)
now runs. *(Native GitHub; demonstrated in the T2 instance.)*

## Act 11 — Deployment (🟦 local harness; 🟩 Environment in T2)
**Say:** deploy → smoke → go/no-go, with rollback on a bad build.
**Run:**
```bash
node demos/validate/run.mjs --filter deployment
```
**Show:** a healthy build smokes green → **go**; a build with a broken `/healthz`
(`break-healthz.mjs`) → **no-go + rollback** (`rollback`, `no-go`).

## Act 12 — Human approves release ⛔ (Environment reviewer, T2)

## Act 13 — Traceability
**Say:** the whole chain is auditable end to end:
> intent → tracking issue → child issues → plan + `plan-approved` label → 3 branches/PRs →
> checks + evals + security + review → human approvals → merge queue → integration test → deployment
> history.

---

## The finale — one command runs the entire matrix
```bash
node demos/validate/run.mjs
```
**Show:** 19/19 fixtures correct, **10/10 negatives caught**, exit 0 — each row labelled by enforcement
type. If any gate were theater, this exits 1 and names the offender.

```
✅ ALL GREEN  19/19 fixtures correct
negatives caught (anti-theater): 10/10
```

## Running Tiers 2 & 3 — see the LIVE RUN section below
The thin callouts that used to live here are superseded by the full **[LIVE RUN](#live-run--the-real-tier-2--tier-3-path-on-azure)** path.

## Presenter timing (T1, offline)
| Segment | Command | ~time |
|---|---|---|
| Pre-flight | `npm --prefix demos/sample-app ci && … build && … test` | 30–60s |
| Acts 1–13 narrated | per-agent `--filter` runs above | 3–5 min |
| Finale | `node demos/validate/run.mjs` | 5–15s |

---

# LIVE RUN — the real Tier-2 + Tier-3 path on Azure

> This is the honestly-live path: real GitHub Issues, the `@copilot` coding-agent fleet, **required**
> status checks + CODEOWNERS + Environments that actually **bite**, and a real **Azure Container Apps**
> deploy with **both** rollback variants. The T1 acts above stay valid as the offline spine; this section
> is what makes each gate *enforce* rather than *assert*.

## ⛔ Load-bearing run order (do NOT reorder — R1 · R6 · gap-review #4)
A required ruleset can self-lock the repo, gates added *after* PRs don't retro-apply, and a check can't be
"required" before its name exists. So the order is fixed:

1. **S0 — T3 preflight FIRST (R1).** Assign a throwaway issue to `@copilot` on the live repo; confirm it
   opens a branch/PR. Decide T3 = **live** vs **seeded/recorded** *before* any Azure spend. Only the
   PR-*authorship* row depends on this; every governance gate runs live either way.
2. **S1 — Repo + seeded "before" app.** Create `agentic-sdlc-demo-live` (public); first commit = the
   working URL-shortener **in its before state** (15 tests green, no limiter) + the harness at root
   (`AGENTS.md`, `CODEOWNERS`, `.github/agents,prompts,workflows`, `ci/`, `orchestrator/`). Open the
   **intake issue**.
3. **S2 — Install PR gates + register check-names BEFORE assigning Copilot (R6 · #4 step b).** Push
   `tests-and-evals.yml` + `security-gate.yml` + `plan-lint.yml` + `deploy.yml`; open a throwaway PR so
   every check-run **name registers**.
4. **S3 — Enforce (#4 step c).** `pwsh demos/deploy/github/enforce-protections.ps1 -Repo … -Reviewer …`
   (it refuses to require a name that hasn't registered — anti-self-lock). Then **verify** a deliberately
   failing PR is **blocked** (#4 step d).
5. **S4 — Azure foundation.** `pwsh demos/deploy/azure/provision.ps1` (ACR + MI + OIDC, idempotent).
6. **Only now** run the story through the live fleet (Acts L1–L12 below).

## L1 — Planning + Rubber-Duck, issue-native (🟦 layered)
**Run the planner** (cloud `@copilot` on the intake issue, or local `decompose-intent`) → it emits the
**PRD tracking Issue** (with the embedded ` ```json agentic-plan ` block) + **child work-unit Issues**,
including the **ordered E2E real-results unit**. The `plan-lint.yml` workflow fires on the labelled issue:
- **Artifact:** a bot **verdict comment** on the issue + the run's pass/fail.
- **Positive:** the clean PRD → ✅ PASS comment.
- **Negative:** edit the issue to mark two store-sharing units `parallelSafe` + the E2E unit parallel →
  ❌ CAUGHT on `parallel-units-share-path` + `integration-marked-parallel`, run goes red.
- **Honest label:** an `on: issues` run **can't** be a native required status check — the gate is the
  comment + run + the dispatcher refusing an unapproved plan.

## L2 — Human plan gate (🟩 native, T2)
Add the **`plan-approved`** label. The dispatcher refuses to fan out until it's present.

## L3 — Dispatch (🟦 orchestration)
```bash
node orchestrator/cli.mjs --assign --repo ozgurkarahan/agentic-sdlc-demo-live --plan plan.json
```
**Positive:** the 3 parallel-safe units' issues are assigned to `@copilot`; **U4 (E2E) held** until U1+U2
land — and `cli.mjs` now **awaits** each assign and **reads the issue back** to verify (R2). **Negative:**
an unapproved plan → refuses, assigns nothing.

## L4 — Dev fleet ×3 (⛔ `@copilot`, the real T3)
The coding agent opens **3 PRs**, each scoped to its unit, each links its issue + adds its test. *(If S0
preflight failed: seeded PRs, reported "not validated" — gates below still run live.)*

## L5 — PR gates, now REQUIRED (🟩 native over 🟦 checks)
Each PR triggers the required checks. `.agent/unit.json` is **required** for work-unit PRs (R4) — a PR
without it **fails** (no skip-green). **Negatives, live on real PRs:**
- **Path-scope:** a PR touching another unit's file → `Path-scope` RED.
- **Trajectory:** a PR with no required test → `Evals` RED.
- **Eval rubric (R5):** a PR that passes unit tests but **limits nothing** → `Evals` RED (runs by the
  unit *contract*, not a filename heuristic — it can't skip the bad code).
- **Security:** a synthetic typosquat/unpinned dep → `Hallucinated-dependency…` RED + CodeQL alert.
Merge is **blocked** until checks pass **and** a **CODEOWNER** approves (🟩).

## L6 — Merge queue (🟩 native if available)
`merge_group` triggers are wired on every required check (R7) so queue entries don't stall. If the
account/repo can't do merge queue, `enforce-protections.ps1` **degrades + documents** it honestly.

## L7–L8 — Deploy to Azure + BOTH rollback variants (🟩 Environment · 🟦 smoke/rollback · ⛔ Azure)
Merge to `master` → `deploy.yml`: build+push to **ACR** by **digest** inside `environment:staging` (the
only place the env-scoped OIDC subject is valid) → **live `/healthz` smoke** with retries → **production
Environment pause (required reviewer ⛔→🟩)** → 0%-traffic canary → smoke the candidate → shift 100% →
post-shift smoke → **go**; GitHub **Deployment** recorded.
- **Rollback variant A (staging fault):** `workflow_dispatch` with `inject_fault=true` → `FAULT_HEALTHZ=1`
  → **staging smoke fails → no-go, prod untouched.**
- **Rollback variant B (prod-only canary fault, #3):** `inject_prod_fault=true` → staging passes
  (`FAULT_HEALTHZ=0`) but the prod **canary** sets `FAULT_HEALTHZ_PROD=1` → **0%-canary smoke fails →
  traffic restored to the captured last-good revision/weights** (R10), deployment marked failed.
- **E2E real-results gate (R13):** after smoke, the harness-authored E2E hits the **live URL** — under
  threshold 200, past threshold 429 + `Retry-After`/`RateLimit-*`. *(Meta-verified against the reference
  oracle: real URL, all three cases, actually gating — not a stub.)*

## L9 — Secretless posture (confirm on camera)
No `AZURE_CLIENT_SECRET`, no registry password anywhere: OIDC mints a short-lived token for the control
plane; each app's **AcrPull managed identity** pulls the private image. Only repo **Variables**
(`vars.AZURE_*`) — identifiers, not credentials. `git log -p | grep -i secret` → nothing.

## L10 — Traceability (real GitHub data)
intent issue → tracking PRD issue → child issues → `plan-approved` label → 3 PRs → required checks/evals/
security/review → CODEOWNERS approval → merge queue → E2E unit → **Azure Deployment record**. Every hop is
a real link, not narration.

## Teardown is MANUAL only (resources stay LIVE for inspection/demo)
Do **not** auto-teardown during validation. For later cleanup:
`pwsh demos/deploy/azure/teardown.ps1` (Azure + identity + repo vars) and
`pwsh demos/deploy/github/enforce-protections.ps1 -Remove` (ruleset + Environments). Both verify zero
residual spend/trust. Re-provision is idempotent.


# LOOP 3 — Durable Handoff (closed-loop deploy/run-status)

> **Purpose:** this file is the **session-independent** source of truth for Loop 3. It exists so a
> fresh Copilot session can resume with ZERO loss — do NOT rely on a session-local `plan.md` or the
> session SQL todos (rubber-duck "missing" item; answers the human's "start a new session?" question).
> Loop memory of *outcomes* lives in [`HARNESS_CHANGELOG.md`](./HARNESS_CHANGELOG.md); deferred work in
> [`HARNESS_BACKLOG.md`](./HARNESS_BACKLOG.md).

## Frozen goal
Close the **deploy/run-status loop (G1–G3)** so a failing GitHub Actions run is **detected by the
harness** and **caught by the OFFLINE regression guard**, proven live with **one green + one
deliberately-failing run**, **without ever faking green**. Observability (G4) + Azure SRE agent + S6
are **deferred to L4** (`HARNESS_BACKLOG.md` B1). Scope set by rubber-duck verdict **GO-WITH-FIXES**.

## The gaps this closes (probe-verified)
- **G1** Deployment agent didn't observe Actions run status (smoke + rollback only).
- **G2** Orchestrator was fire-and-forget (assign → exit; no poll/retry/feedback).
- **G3** Learning loop verified deploy by `/healthz` only, never the run conclusion.

## Status (update as waves complete)
- ✅ **Wave 0** — memory ingest (SME verdict, standing constraints, Karpathy draft); this handoff; `HARNESS_BACKLOG.md`.
- ✅ **Wave 1 (offline)** — M1 pure lib + adapter · M2 validator driver + 7 fixtures · M3 orchestrator `--watch` · M4 LM-judge advisory + 2 fixtures · M5 §11 annotation. Validator **49/49, 28/28 negatives, exit 0**.
- ✅ **Wave 2 (LIVE, 2026-06-28)** — full closed loop proven on the public `agentic-sdlc-demo-live`:
  **@copilot dispatch** (orchestrator `--assign` → issue #29 → @copilot opened PR #32);
  **GREEN** PR #30 (`4a2710c4`) Tests & Evals success → `--watch` GO, exit 0;
  **RED** PR #31 (`eb4a7b98`) Tests & Evals failure → `--watch --report-issue 29` NO-GO, exit 1, **NO-GO comment posted to #29**.
  Bonus deploy `inject_fault` run dispatched (28336842138); `--watch` held `pending→wait` (transient path proven) while GitHub queued the runner.
- ✅ **Wave 3 (close)** — regression green + loop memory (`HARNESS_CHANGELOG.md` Loop 3, `validation-log.md` L20–L26) + project wiki updated.

## What shipped in Wave 1 (files)
| File | Role |
|---|---|
| `demos/ci/lib/run-status.mjs` | **PURE** classifier/oracle + retry taxonomy (`classifyConclusion`, `selectRun`, `evaluateRunStatus`, `decideReaction`). No I/O. |
| `demos/ci/lib/gh-run-reader.mjs` | **Adapter** — the only place that shells `gh` (`readRuns`/`readRun`/`readPrChecks`). Normalizes to the pure schema. |
| `demos/ci/scripts/workflow-conclusion-check.mjs` | CLI gate: `--input <fixture>` (canned) or live `--repo/--workflow/--sha`. Exit 0 only on GO. |
| `demos/validate/run.mjs` | new drivers `workflow-conclusion` + `lm-judge`. |
| `demos/orchestrator/cli.mjs` | new `--watch` mode (poll → classify → react per taxonomy → `--report-issue`). |
| `demos/ci/scripts/lm-judge.mjs` | advisory default-on; deterministic `--verdict`/fixture input; ALWAYS exit 0. |
| `docs/.../harness/agents/deployment.agent.md` | run-conclusion-aware procedure + guardrail. |
| `demos/CONTRACT.md` | §4 deployment driver registered; §11 crutch/durable annotation. |

## Fixture inventory (the offline proof — a "red pipeline" is replayable JSON)
`demos/scenarios/s1-rate-limit/fixtures/deployment/` (driver `workflow-conclusion`):
- `positive-workflow-conclusion-success.json` — success → GO
- `positive-workflow-conclusion-rerun-attempt2.json` — attempt-1 fail, attempt-2 success → GO
- `negative-workflow-conclusion-failure.json` — failure for SHA → NO-GO (`run-failed`)
- `negative-workflow-conclusion-wrong-sha.json` — green but WRONG sha → NO-GO (`no-matching-run`)
- `negative-workflow-conclusion-older-green-newer-red.json` — newest wins → NO-GO (`run-failed`)
- `negative-workflow-conclusion-queued-timeout.json` — not completed → NO-GO (`run-incomplete`)
- `negative-workflow-conclusion-cancelled.json` — cancelled → NO-GO (`run-cancelled`)

`demos/scenarios/s1-rate-limit/fixtures/quality-test/` (driver `lm-judge`):
- `positive-lm-judge-advisory-skip.json` — no token → skip → pass
- `negative-lm-judge-advisory-fail.json` — verdict fail → finding recorded (fires) but script exits 0

## Acceptance commands
```pwsh
node demos/validate/run.mjs                          # 49/49 fixtures, 28/28 negatives, exit 0
node demos/validate/run.mjs --filter deployment       # run-conclusion negatives caught
node demos/ci/scripts/lm-judge.mjs --input demos/scenarios/s1-rate-limit/fixtures/quality-test/negative-lm-judge-advisory-fail.json --json   # flagged:true, pass:true, exit 0
# live (Wave 2):
node demos/orchestrator/cli.mjs --watch --repo ozgurkarahan/agentic-sdlc-demo-live --sha <headSha> --workflow deploy --report-issue <n>
```

## Wave 2 — human/account touchpoints (NOT cost; cost is no constraint)
1. `gh auth refresh -s workflow` (workflow token scope).
2. Confirm public `ozgurkarahan/agentic-sdlc-demo-live` exists with the harness at root, and the
   **`@copilot` coding agent is enabled** on it.
3. Dispatch a throwaway issue to `@copilot`; when its PR opens, run `orchestrator --watch` against the
   deploy run for the PR's head SHA.
4. Prove **one green run → GO** and **one deliberately-failing run → NO-GO + reported to the issue**.
   (Deliberately-fail by, e.g., a unit that breaks a required check.) Staging→prod + both rollbacks +
   harness E2E were already proven in Loop-1 — re-affirm, don't rebuild.

## Open decisions (defaults chosen; override if needed)
- **D-A** SRE agent + S6 + observability → **deferred to L4** (`HARNESS_BACKLOG.md` B1).
- **D-B** Karpathy decision-wiki → **L4 prototype** (`HARNESS_BACKLOG.md` B2).
- **D-C** live repo → **reuse** `agentic-sdlc-demo-live`.
- **D-D** retry taxonomy → **retry only transient** (queued-timeout, runner/infra cancellation, gh/API);
  never auto-retry failed tests/smoke/deploy/E2E. Encoded in `run-status.mjs#decideReaction`.
- **D-E** run-status IO → **poll `gh run`/`gh pr checks`** (not a webhook) — right for a presenter demo + offline-fixtureable.

## Known risks / honest boundaries
- `gh run list` omits `attempt` (defaults to 1); true attempt comes from `gh run view` — the adapter upgrades when needed.
- Live `--watch` depends on `gh` auth + Actions API availability (a hiccup is treated as transient).
- The LM-judge remains advisory — it is **not** part of the green invariant (by design; promotion = backlog B3).
- Observability/G4 is **not** addressed here — production exceptions are still invisible until B1 ships.

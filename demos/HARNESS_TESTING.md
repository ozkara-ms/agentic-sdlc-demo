# Harness Stress Protocol — how we test the harness and make it better

> **Why this file exists (human directive, 2026-06-28):** *"Test ALL agents and see what to improve — let
> the harness DO things and check whether the result is what we expected. Write down what was fixed/changed
> so the loop remembers and doesn't redo it. Document this way-of-testing so we remember how we tested &
> improved the harness."* This file is the **repeatable methodology**; `HARNESS_CHANGELOG.md` is the
> **loop-memory** (what each scenario tested / broke / fixed, agent by agent).

The harness is the set of deterministic gates under `demos/` that govern the agentic SDLC pipeline
(planning, rubber-duck, dispatcher, dev-fleet, quality-test, security, code-review, deployment,
orchestrator). A gate is only trustworthy if it **passes the good path AND catches its specific bad
path** — never theater (always-green) and never a false-block (red on a legitimate change). This
protocol is how we keep proving that as we add new scenarios, and how we generalize any gate that
turns out to be secretly hard-wired to one scenario.

---

## 0. Core principle — the harness must be SCENARIO-GENERAL

A scenario = one intent run through the pipeline (S1 = "add rate limiting"). The harness was originally
mono-scenario (every oracle baked S1's 429/Retry-After). **A second scenario must run by adding a
folder, never by editing the validator or runner.** When a new scenario can't run without touching
shared harness code, that coupling *is the defect to fix*. See `CONTRACT.md` §10 for the scenario axis.

---

## 1. The protocol (run this for EVERY new scenario)

| Step | Action | Output |
|------|--------|--------|
| **1. Intent** | Write the one-line intent + a **machine-checkable** acceptance contract (e.g. "POST malformed body → 400 + JSON error; valid → 2xx"). | `scenarios/<id>/scenario.json` |
| **2. Oracle** | Express acceptance as a **rubric module** (`rubric.mjs`) that probes the app and emits `{checks, signals, pass}`. Reuse a shared rubric (`ci/scripts/rubrics/*`) if one fits; otherwise author a new one. | `scenarios/<id>/rubric.mjs` (+ maybe a new shared rubric) |
| **3. Fixtures** | For each agent the scenario stresses, derive a **positive** fixture (good path → pass) and a **negative** fixture (the specific failure that gate must catch). Add app **variants** the eval mounts. | `scenarios/<id>/fixtures/<agent>/*.json` + `variants/*.mjs` |
| **4. Run** | `node demos/validate/run.mjs --scenario <id>`. | pass/blocked per fixture |
| **5. Classify** | For each result decide: **expected-catch** (gate bit correctly = GOOD) vs **harness-defect** (S1-coupling, theater = false-green, or false-block). | a verdict per fixture |
| **6. Fix** | For each harness-defect: fix the gate so it is **scenario-general** (read the scenario's own oracle/manifest, not an S1 literal). **≤3 fix→re-run attempts per gate**, then record it KNOWN-DEFECT and move on. | a harness edit + a re-run |
| **7. Record** | Append to `HARNESS_CHANGELOG.md`: agent × scenario — tested? behaved-as-expected? defect found? fix applied? Append `L13+` to the session ledger `files/validation-log.md`. | loop-memory updated |

**Regression guard (non-negotiable):** after ANY harness edit, re-run `node demos/validate/run.mjs`
(all scenarios) and confirm the full matrix is **49/49, 28/28 negatives caught, exit 0** and S1 stays
green. A generalization that breaks an existing scenario is not done.

---

## 2. "The harness is better" — the success criteria

A loop iteration improved the harness iff **all** hold:
- **No S1 hardcoding remains** in any shared gate touched (no `429`/`Retry-After`/`rateLimit`/route literal
  in the validator, runner, or a gate that a second scenario must reuse).
- **Every gate is parameterized by the scenario's own oracle** (manifest + rubric), not a baked constant.
- **All negatives still caught** for every scenario (anti-theater holds across the board).
- **S1 still green** (regression guard).
- The new scenario's positives pass and negatives are caught **for the right reason** (the emitted
  `signals` name the actual flaw, not a generic failure).

---

## 3. Classifying a result (step 5 in detail)

| Symptom | Classification | Action |
|---------|----------------|--------|
| Positive fixture **passes**, negative **blocked**, signals name the real flaw | ✅ expected — gate works | record VALIDATED |
| Negative **passes** (not caught) | ❌ **theater / false-green** | fix the gate to actually assert; this is the worst defect |
| Positive **blocked** (legit change rejected) | ❌ **false-block** | loosen/correct the gate; it's over-fitting |
| Scenario **can't run** / gate errors on non-S1 input | ❌ **S1-coupling** | generalize the gate to read the scenario's oracle |
| Negative caught but **for the wrong reason** (wrong signal) | ⚠️ partial | sharpen the rubric's signal mapping |

Never edit a fixture to make a red gate green. Fix the **gate** (or record KNOWN-DEFECT). The negative
fixtures are the harness's conscience.

---

## 4. Per-agent expectation table (what each gate must do + how to stress it)

| Agent / gate | Check script | Good path (positive) | Must-catch (negative) | How a new scenario stresses it |
|---|---|---|---|---|
| **Planning** | `ci/scripts/plan-lint.mjs` | well-formed plan: every unit has acceptance+DoD+test, dependent unit marked ordered | a dependent unit marked `parallel-safe`, or a unit missing DoD/test | give the scenario a real ordering (e.g. integration test depends on impl) |
| **Rubber-Duck** | `ci/scripts/plan-lint.mjs` (structural backstop) | a corrected plan → PASS | a hidden cross-unit dependency + unsafe parallelization | inject a flaw unique to the scenario's decomposition |
| **Dispatcher / Orchestrator** | `orchestrator/dispatch.mjs` + `validatePlan` | fans out only the approved plan, respects waves | unapproved plan, dependency cycle, dup id, ordered-marked-parallel, two parallel units sharing a path | author malformed plans of each shape (see S5) |
| **Dev-fleet (path-scope)** | `ci/scripts/path-scope-check.mjs` | PR edits only its unit's declared paths | a PR straying into another unit's files | declare the scenario's per-unit paths; make a negative stray |
| **Dev-fleet (trajectory)** | `ci/scripts/trajectory-check.mjs` | PR adds the required test | a PR with no test for its unit | declare the scenario's required test path |
| **Quality-Test** | `ci/scripts/eval-rubric.mjs` + the scenario `rubric.mjs` | a candidate satisfying the acceptance oracle | a candidate that passes unit tests but **fails the oracle** | **the scenario's acceptance is the oracle** — this is the main generalization driver |
| **Security** | `ci/scripts/pin-check.mjs` (+ slopsquat) | pinned, real deps | an unpinned / typosquatted / mutable-range dep | give the scenario a PR that adds a dependency |
| **Code-Review** | `ci/scripts/doc-coupling-check.mjs` | code change ships with doc + test update | an arch change with no doc update | declare the scenario's code↔doc coupling |
| **Deployment** | `ci/scripts/smoke-check.mjs` | live `/healthz` 200 → go | a faulted build (500) → no-go + rollback | scenario can reuse the smoke gate as-is (content-general) |
| **Deployment (run-status, Loop-3)** | `ci/scripts/workflow-conclusion-check.mjs` (+ `ci/lib/run-status.mjs`) | the deploy run for the target SHA concluded `success` → go | a red/cancelled/timed-out/queued run, or a green run for the WRONG sha, or an older-green+newer-red → no-go | scenario reuses the oracle as-is; fixtures carry canned `runs`+`identity` (content-general) |

---

## 5. Adding a scenario (the concrete recipe)

1. `demos/scenarios/<id>/scenario.json`:
   ```json
   {
     "id": "<id>", "title": "...", "intent": "one line",
     "acceptance": "machine-checkable statement",
     "evalRubric": "rubric.mjs",
     "evalDefaults": { "route": "/path", "method": "POST", "max": 3 },
     "appVariants": { "good": "variants/good.mjs", "bad": "variants/bad.mjs" },
     "e2eTest": "test/e2e/<id>.e2e.test.ts"
   }
   ```
2. `rubric.mjs` — either `export { evaluate, meta } from '../../ci/scripts/rubrics/<shared>.mjs'`
   (adopt a shared oracle) **or** author a new oracle that exports
   `async evaluate({ probe, args }) -> { rubric, checks, signals, observed, pass, detail }` + `meta`.
   `probe(route, method, body)` is a port-bound HTTP client the runner injects.
3. `variants/<name>.mjs` — Express middleware factories the eval mounts (a `good` + one per negative).
4. `fixtures/<agent>/<case>.json` — schema = `CONTRACT.md` §4; set `input.appVariant` to the variant name
   for eval fixtures.
5. `node demos/validate/run.mjs --scenario <id>` → iterate via the protocol above.

---

## 6. Guardrails (standing)

- **Never fake a green.** A red gate is fixed in the gate or recorded KNOWN-DEFECT — never by weakening the
  negative fixture.
- **≤3 fix→re-run per gate**, then KNOWN-DEFECT + continue + surface in the report.
- **Keep S1 green** after every refactor (the regression guard).
- The **source repo `agentic-sdlc-demo` stays local-only** (commit, do not push) unless explicitly asked.
- A **live capstone** keeps both Azure apps live + healthy (no teardown); verify live outcomes out-of-band.
- **Deferred work goes to [`HARNESS_BACKLOG.md`](./HARNESS_BACKLOG.md)** (the discussion home), not silently dropped; the **current loop's durable handoff** is [`LOOP3.md`](./LOOP3.md) (so a fresh session resumes with zero loss).

---

## 7. How to run

```bash
node demos/validate/run.mjs                 # all scenarios — full regression
node demos/validate/run.mjs --scenario s1   # one scenario (full id or short prefix, e.g. s1)
node demos/validate/run.mjs --json          # machine-readable summary {total,passed,failed,...}
```
Exit codes: `0` all-correct · `1` a fixture behaved wrong · `2` no fixtures matched the filter.

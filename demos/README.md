# `demos/` — the runnable demo (makes the harness execute + validate itself)

> Entry point. The keystone is **[`CONTRACT.md`](./CONTRACT.md)** — read it first. The presenter's
> step-by-step golden path is **[`DEMO_SCRIPT.md`](./DEMO_SCRIPT.md)**.
>
> **Loop docs:** [`HARNESS_TESTING.md`](./HARNESS_TESTING.md) (how we test+improve the harness) ·
> [`HARNESS_CHANGELOG.md`](./HARNESS_CHANGELOG.md) (loop memory) ·
> [`HARNESS_BACKLOG.md`](./HARNESS_BACKLOG.md) (deferred work) ·
> [`LOOP3.md`](./LOOP3.md) (current loop — durable handoff).

## What this is

The asset under [`../docs/agentic-engineering-on-github/`](../docs/agentic-engineering-on-github/) ships an
**EXAMPLE** harness (agent personas, `AGENTS.md`, two workflows). This `demos/` tree turns it into a
**runnable, self-validating** pipeline around a real Node/TS URL-shortener, in three tiers — each a
superset of the prior:

| Tier | What it proves | External deps | How to run |
|---|---|---|---|
| **T1 — local backbone** | harness logic + each agent's **artifact contract**, every gate catches its seeded negative | none | `node demos/validate/run.mjs` (+ `npm --prefix demos/sample-app test`) |
| **T2 — enforced repo** | the gates actually **bite** (required checks, reviews, Environments, merge queue) | admin + `workflow` scope | instantiated into a dedicated repo at **D7** |
| **T3 — live fleet** | real `@copilot` agents author PRs from issues | coding-agent enabled | **D8** (conditional on preflight; pre-recorded fallback) |

T1 is the **deterministic spine** and is the part you can run right now, fully offline. T2/T3 require a
target GitHub repo and are documented for instantiation.

## Run Tier-1 in 30 seconds

```bash
# 1. install + build + test the sample app (the system under test)
npm --prefix demos/sample-app ci
npm --prefix demos/sample-app run build
npm --prefix demos/sample-app test          # 15 unit+e2e tests, all green

# 2. run the whole seeded validation matrix (49 fixtures, 28 adversarial negatives)
node demos/validate/run.mjs                  # exit 0 only if every gate behaves correctly
```
The matrix prints one row per agent/gate, each **labelled by enforcement type**, and fails loudly
(THEATER) if any negative fixture is not caught. See [`validate/README.md`](./validate/README.md).

## Directory map

```
demos/
  CONTRACT.md         # FROZEN keystone every unit reads (locked decisions, story, schema, honesty map)
  DEMO_SCRIPT.md      # presenter golden path — the one story, stage by stage, with commands
  ATTRIBUTION.md      # MIT attribution for adapted awesome-copilot personas
  README.md           # (this file)

  sample-app/         # the system under test: Node/TS/Express URL-shortener, "before" state (no limiting)
                      #   real unit+e2e tests (Vitest+supertest), lint, build, Dockerfile

  agents/             # pointer only → the 7 enriched personas (+ orchestrator.agent.md) and AGENTS.md
                      #   live single-source in ../docs/agentic-engineering-on-github/harness/

  orchestrator/       # the dispatcher (connective tissue we build, NOT a GitHub primitive)
    dispatch.mjs        #   pure decision fn: gates on plan-approved, fans out waves, holds ordered units
    cli.mjs             #   CLI over dispatch.mjs
    example-plan.json   #   the canonical frozen-story plan (U1‖U2‖U3 parallel, U4 ordered)

  ci/                 # makes verification REAL (replaces the EXAMPLE echoes)
    scripts/            #   eval-rubric · pin-check · trajectory · path-scope · plan-lint · smoke ·
                        #   doc-coupling · lm-judge (all callable offline, exit 0=pass / 1=caught)
    workflows/          #   tests-and-evals.yml + security-gate.yml (real commands; target `master`)

  fixtures/<agent>/   # seeded positive + adversarial-negative inputs per agent (CONTRACT §4 schema)
  validate/run.mjs    # Tier-1 runner: drives each fixture through its gate, asserts pass/catch
  evidence/           # (T3) captured runs / pre-recorded fallback
```

## The one story (frozen)

> *"Add rate limiting to the URL-shortener API so a single client can't exhaust the service."*

It decomposes into **3 parallel-safe units** (limiter middleware · config surface · docs) + **1 ordered
unit** (integration test, depends on the first two). Every agent in the roster touches this one story;
`DEMO_SCRIPT.md` threads it end-to-end and shows each negative variant being caught.

## Honesty (the load-bearing rule)

Every gate result is labelled by enforcement type so nothing reads as a stronger guarantee than it is:

- 🟩 **native GitHub** — branch protection / ruleset / required review / Environment / GHAS does the block.
- 🟦 **required CI job** — our workflow job, made a required status check in T2.
- 🟦 **local assertion** — `demos/validate` proves the catch in T1 (logic proof, not a platform block).
- 🟨 **advisory** — a non-blocking review signal (e.g. doc-coupling); the native block is CODEOWNERS.
- ⛔ **external dependency** — needs the Copilot coding-agent / GitHub Models / a human action.

The **dispatcher's plan-approved gate is layered orchestration, never native pre-code enforcement** —
GitHub does not enforce "plan approval"; the dispatcher simply *chooses* not to fan out. See
[`CONTRACT.md`](./CONTRACT.md) §5 and [`orchestrator/README.md`](./orchestrator/README.md).

## Status

- **T1 (local backbone): complete and green** — sample app builds + 15 tests pass; the validation
  matrix is 49/49 with all 28 negatives caught (Loop-3 added the run-status + advisory-LM-judge gates).
- **T2 / T3:** documented and ready to instantiate into a dedicated repo (D7→D8); not enabled on this
  asset-authoring repo by design.

Build order and tier-separated Definition of Done are in [`CONTRACT.md`](./CONTRACT.md).

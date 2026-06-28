# Agentic SDLC Demo

## Overview

A ready-to-run, **presenter-led demo environment** that showcases the full software development lifecycle driven by AI coding agents. The demo starts from a real-world *input* — a new requirement, meeting notes, or an action item — and walks an audience through the entire lifecycle with agents: requirements analysis → planning & design → implementation → testing → code review → pull request → deployment & docs. Each stage is a self-contained "functionality" that can be demoed independently or chained into one continuous end-to-end story. This is a **customer-facing showcase, not a hands-on lab**: the presenter (Ozgur) drives, the audience watches the agentic workflow in action.

## Engagement Details

| Field | Value |
|-------|-------|
| Client | Internal demo asset (reusable across customers) |
| Topic | Agentic Software Development Lifecycle |
| Format | Demo (presenter-led, customer-facing) |
| Audience | Customer technical leadership + technical stakeholders; reusable across audiences |
| Status | In progress — reusable white-label asset **"Agentic Engineering on GitHub"** authored under `docs/agentic-engineering-on-github/` (Story + Agents/Skills/Harness + GitHub pipeline + drop-in `harness/`). **Tier-1 runnable demo backbone complete** under `demos/` (sample app + 6-agent harness + dispatcher + 19-fixture validation matrix, all green offline). **Phase 0 of the live path complete (2026-06-28, commit `4a34e7b`, unpushed):** all 13 rubber-duck wiring fixes (R1–R13) applied — ACR + managed-identity deploy-by-digest + both rollbacks, issue-native plan-lint, CODEOWNERS/ruleset automation with anti-self-lock, harness-defined live E2E; release path is **secretless** (OIDC + AcrPull MI). Tiers 2–3 live execution (enforced GitHub repo + live `@copilot` fleet + real Azure spend) is the **human-gated Phase A** next step |

## Demo Concept

**Input → full lifecycle with agents.** The spine of the demo is one idea: drop in an input, let the agent take it all the way to a shipped, documented change.

| # | Stage | What the agent does | What the audience sees |
|---|-------|---------------------|------------------------|
| 1 | Requirement intake | Ingest a requirement / meeting notes / action item | A messy real-world input becomes a structured spec |
| 2 | Plan & design | Produce a plan, break into tasks, propose a design | Plan-mode output, task list, design notes |
| 3 | Implement | Write the code for the feature | Live edits across files |
| 4 | Test | Generate and run tests | A green test run |
| 5 | Review | Agent-driven code review | Review findings and fixes |
| 6 | Pull request | Open a PR with a summary | A real PR rendered |
| 7 | Deploy & docs | Deploy and/or update documentation | A deployed change + refreshed docs |

Each stage is a "functionality in the repo" the presenter can jump to independently, or run as one continuous flow.

## Deliverables

- [ ] **Demo environment** — a sample application/repo the agent evolves live
- [ ] **Seed input artifacts** — a sample requirement, sample meeting notes, and a sample action item (the demo's starting points)
- [ ] **Per-stage demo flows** — one runnable script/path per lifecycle stage (intake → plan → implement → test → review → PR → deploy)
- [ ] **End-to-end demo script** — step-by-step narration with talking points
- [ ] **Setup instructions** — clean-environment reproducible
- [ ] **Fallback plan** — pre-baked branch / pre-recorded output if a live agent run stalls on stage
- [x] **Story & talking points** — the "why agentic SDLC" narrative for the audience *(delivered as the reusable asset below)*
- [x] **Reusable "Agentic Engineering on GitHub" asset** — client-agnostic narrative + reference harness under `docs/agentic-engineering-on-github/` (the Story; Agents + Skills + Harness; the GitHub-powered pipeline in fleet mode; drop-in example `harness/`)
- [x] **Tier-1 runnable demo backbone** — `demos/` executes offline: sample app + 6-agent harness + dispatcher + 19-fixture validation matrix (`demos/validate/run.mjs`, 10/10 negatives caught) + presenter guide (`demos/DEMO_SCRIPT.md`). Tiers 2 (enforced GitHub repo) and 3 (live `@copilot` fleet) remain human-gated.

## How to Verify

| Check | Command | Expected result |
|-------|---------|-----------------|
| Demo dry-run | Walk the end-to-end script from a clean clone | Every stage runs from the written script — no improvisation needed |
| Fallback | Trigger the fallback path once | Pre-baked branch / recording renders the same outcome |
| Setup | Follow setup instructions on a clean environment | Environment reproduces from scratch with no hidden state |
| Asset integrity | Lint `docs/agentic-engineering-on-github/harness/**/*.yml` + check the asset's internal links | All harness YAML parses; every cross-doc link resolves |
| **Tier-1 demo (runnable, offline)** | `node demos/validate/run.mjs` | `49/49 fixtures correct`, `negatives caught: 28/28`, exit 0 — each gate labelled by enforcement type |
| **Harness run-status gate (Loop 3)** | `node demos/validate/run.mjs --filter deployment` | deployment positives pass + run-conclusion negatives caught (red-for-SHA, green-for-wrong-SHA, older-green+newer-red, queued-timeout, cancelled) |
| **Harness scenario (one)** | `node demos/validate/run.mjs --scenario s1` | one scenario's positives pass + negatives caught (scenario axis — `CONTRACT.md` §10) |
| **Tier-1 sample app** | `npm --prefix demos/sample-app ci && npm --prefix demos/sample-app test` | 15 unit+e2e tests green (the "before" URL-shortener, no rate limiting yet) |

**Definition of done:** the full input→lifecycle demo runs end-to-end from the written script on a clean environment, AND the fallback plan has been exercised at least once.

## Quick Reference

### Setup

```pwsh
# Prerequisites + setup to be defined in the first working session,
# once the sample app + agent toolchain are chosen.
```

### Common Commands

```pwsh
# Demo flows live under demos/ ; talking points + setup + fallback under docs/

# Tier-1 runnable demo (offline, deterministic):
node demos/validate/run.mjs                 # full gate matrix, all scenarios (anti-theater)
node demos/validate/run.mjs --scenario s1   # one scenario (scenario axis — CONTRACT.md §10)
node demos/validate/run.mjs --filter security-compliance   # one agent's positive+negative
node demos/orchestrator/cli.mjs --plan demos/orchestrator/example-plan.json   # dispatcher fan-out
# Presenter golden path (stage → command → artifact → negative caught): demos/DEMO_SCRIPT.md
# How we test + improve the harness (the repeatable protocol):          demos/HARNESS_TESTING.md
# Loop-memory: what each scenario tested / broke / fixed (agent×scenario): demos/HARNESS_CHANGELOG.md
# Entry point + tier map + honesty labels:                              demos/README.md
```

## Key Paths

| Path | Description |
|------|-------------|
| `demos/` | Runnable demo: `sample-app/` (system under test) · `orchestrator/` (dispatcher) · `ci/scripts/` + `ci/workflows/` (real verification) · `scenarios/<id>/` (per-scenario manifest+rubric+variants+fixtures — scenario axis) · `validate/run.mjs` (gate matrix, `--scenario`) · `CONTRACT.md` (keystone, §10 = scenario axis) · `HARNESS_TESTING.md` (how we test+improve the harness) · `HARNESS_CHANGELOG.md` (loop-memory) · `DEMO_SCRIPT.md` (presenter golden path) · `README.md` (entry point). The 7 enriched agent personas + `AGENTS.md` live single-source in the asset `harness/` (below); `demos/agents/` is just a pointer. |
| `docs/agentic-engineering-on-github/` | Reusable white-label asset: the Story + Agents/Skills/Harness + GitHub pipeline + drop-in `harness/` examples |
| `docs/` | Talking points, setup, fallback plan, the narrative |
| `inputs/` *(add in first session)* | Seed artifacts: sample requirement / meeting notes / action item |
| `app/` *(add in first session)* | The sample application the agent evolves during the demo |

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| _TBD in first session_ | Depends on the chosen sample app + agent toolchain | — |

## Deployment

To be defined with the sample app in the first session (e.g. `azd up`, GitHub Actions, or a local run). Stage 7 of the demo is itself the deployment story, so keep it simple and live-demoable.

## Workflow Rules

Read `~/projects/memory/agent-config/workflow.md` for the full set of global workflow rules. Key rules summarized here:

1. **Plan Before Coding** — For any task with 3+ steps, outline the approach first. Get approval before implementing.
2. **Verify Before Done** — Never mark a task complete without proving it works. Run the checks in **How to Verify** above; if that section is still empty or stale, updating it is part of the current task.
3. **No Blind Retries** — Diagnose root cause on failure. Don't retry non-transient errors.
4. **Keep It Simple** — Don't add features, refactor code, or make improvements beyond what was asked.
5. **Wiki-First Memory** — Durable lessons live in `~/projects/memory/wiki/`, NOT in per-project `.ai/` folders (deprecated 2026-04-22).

## Standing design constraints (Ozgur, 2026-06-28 — apply to ALL designs)

- **Azure = internal subscription; cost is NOT a constraint.** Never gate, shrink, or simplify a design to save spend — prefer the *correct* architecture. (Full note: `~/projects/memory/agent-config/platform.md`.)
- **Destined for PUBLIC-INTERNET publication** (a Microsoft solution). Design for public consumption: secretless posture (OIDC + managed identity), LICENSE, reproducible clean-clone setup, no internal-only assumptions, presentable docs.

## Platform & Environment

Read `~/projects/memory/agent-config/platform.md` for full platform preferences. Common reminders:

- Windows 11 + PowerShell, Python 3.12 (use `python` not `python3`)
- ARM64 dev machines: avoid native-extension wheels that lack arm64 builds (e.g. `uvicorn[standard]` → `httptools`)
- venv at `.venv/`, activated via `.\.venv\Scripts\Activate.ps1`
- All subprocess calls: `encoding="utf-8", errors="replace"` (Windows console is cp1252 by default)

## Reference Documents

| Document | Contents |
|----------|----------|
| `~/projects/memory/wiki/projects/agentic-sdlc-demo.md` | Canonical project memory page |
| `~/projects/memory/wiki/projects/skywise-ai-app-factory.md` | Adjacent: Cyril's Airbus/Skywise end-to-end SDLC automation demo proposal |
| `~/projects/memory/wiki/domains/github-copilot-agentic-devops.md` | GitHub Copilot as governed Agentic DevOps platform |
| `~/projects/memory/wiki/projects/big-bets-fy26-ozgur.md` | Where this demo can land as an FY26 Big Bet |
| `~/projects/memory/glossary.md` | Canonical terms: Agentic DevOps, Agentic Development Cycle (ADC), Four Waves of AI SDLC |

## First Session Instructions

When the agent is first launched in this project:

1. **Read all existing files** to understand the current state.
2. **Research the topic** — the latest agentic-SDLC capabilities and demoable surfaces: GitHub Copilot CLI + coding agent + PR review, Claude Code, GitHub Actions, Azure deploy. Cross-reference the memory wiki: `github-copilot-agentic-devops`, `skywise-ai-app-factory`, the ADC (Agentic Development Cycle), and the Four Waves of AI SDLC.
3. **Enter plan mode** and propose:
   - The **sample app** to build/evolve (small but real enough to exercise all 7 stages)
   - The **input→lifecycle story** and the three seed inputs (requirement / meeting notes / action item)
   - One **runnable flow per stage** plus the end-to-end script
   - The **fallback plan**
4. **Wait for user approval** before creating any content files.
5. **After approval**, scaffold `app/` + `inputs/`, write the demo scripts under `demos/`, draft talking points under `docs/`, then rehearse the end-to-end run.

## What NOT To Do

- Do not turn this into a hands-on lab — it is presenter-led; the audience watches the agent work.
- Do not start building the sample app before the plan is approved (Step 4 above).
- Do not create `.ai/lessons-learned.md` or `.ai/project-reference.md` — that pattern was deprecated 2026-04-22. Project knowledge lives directly on the wiki page.
- Do not commit `.env` or any secret-bearing files (already in `.gitignore`).
- Do not add comments, docstrings, or type annotations to code you didn't change.
- Do not over-engineer the sample app — it exists to showcase the workflow, not to be a product.

## End-Session Workflow

When the user says "end session", "wrap up", or "done for today" — see `.github/instructions/end-session.instructions.md` for the project-specific shim. Routes durable findings to the wiki, runs `git status`, and reports a summary.

# harness/ — drop-in artifacts that make the harness real

> These are **copy-pasteable EXAMPLES** that instantiate the Harness Configuration Map in
> [`../02-agents-skills-harness.md`](../02-agents-skills-harness.md). They live **under `docs/`** so
> they do **not** run in or govern this demo repo. Copy them into a **target repo** to stand up the
> pipeline.

## ⚠️ The load-bearing caveat — files alone do not enforce governance

Copying these files gives you the **behavior-shaping** layer of the harness (instructions, personas,
procedures, intake). It does **not**, by itself, enforce anything. **Real enforcement** requires
configuring, in the target repo:

- **Rulesets / branch protection** on `main`.
- **Required status checks** — mark the `tests`, `evals`, and security jobs **required**.
- **Required reviews** + **CODEOWNERS**.
- **Environments** with protection rules (required reviewers / wait timers) for deploys.
- **Merge queue** for safe fan-in.

Until those are set, the example workflows are just jobs and the rule files are just guidance. (See
the enforcement-boundary map in `../02-agents-skills-harness.md` Part 4.)

## What's here

| Path | Maps to | Harness component |
|---|---|---|
| `AGENTS.md` | repo root `AGENTS.md` | Instructions / static context (drives the Development fleet) |
| `instructions/agent-safety.instructions.md` | `.github/instructions/` | Safety overlay for all agents |
| `agents/orchestrator.agent.md` | `.github/agents/` | Orchestrator / Dispatcher role |
| `agents/planning.agent.md` | `.github/agents/` | Planning / Requirements role |
| `agents/rubber-duck.agent.md` | `.github/agents/` | Plan-Validation (hard gate) role |
| `agents/quality-test.agent.md` | `.github/agents/` | Quality / Test role |
| `agents/security-compliance.agent.md` | `.github/agents/` | Security / Compliance role |
| `agents/code-review.agent.md` | `.github/agents/` | Code Review role |
| `agents/deployment.agent.md` | `.github/agents/` | Deployment / Validation role |
| `prompts/decompose-intent.prompt.md` | `.github/prompts/` | Decomposition procedure |
| `prompts/validate-plan.prompt.md` | `.github/prompts/` | Plan-validation procedure |
| `skills/*.skill.md` | `.github/skills/` | Agent skills: workspace-hygiene · run-tests · check-deps · deploy · **verify-gates** · **plan-to-issues** |
| `workflows/tests-and-evals.yml` | `.github/workflows/` | Verification: tests + evals |
| `workflows/security-gate.yml` | `.github/workflows/` | Security gate (GHAS) |
| `ISSUE_TEMPLATE/work-unit.yml` | `.github/ISSUE_TEMPLATE/` | Work intake — materialized from the approved plan by `plan-to-issues` |

## How to instantiate (in a target repo)

1. Copy `AGENTS.md` to the **repo root**; fill the bracketed `[...]` parts for your service.
2. Copy `agents/`, `instructions/`, `prompts/`, `skills/`, `ISSUE_TEMPLATE/`, and `workflows/` under the repo's **`.github/`**.
3. Replace the placeholder `echo` steps with your real test / eval / supply-chain commands.
4. Set the **CodeQL language(s)** in `security-gate.yml`.
5. **Run workspace hygiene before every lifecycle attempt:** fetch the remote default branch, confirm the
   checkout is not stale/diverged, and quarantine old generated `.harness` artifacts before trusting an
   existing plan/dispatch file.
6. **Turn on enforcement BEFORE the first unit Issue/PR** (the caveat above): vendor the workflows, add
   `CODEOWNERS`, register the check names (one throwaway PR), then run
   `deploy/github/enforce-protections.ps1 -Repo <org>/<repo> -Reviewer <you>` to require checks +
   CODEOWNERS review + Environments, and confirm with the **`verify-gates`** skill. **Files alone enforce
   nothing — this is the load-bearing step** (skipping it = unit PRs merge ungated; the F6 gap).
7. **Drive the lifecycle:** local planning → rubber-duck → human approval → **`plan-to-issues`** (create the
   GitHub Issues) → dispatch each Issue to a dev-fleet agent or **Copilot cloud agent** → gated PRs.
8. Set the white-label variables (`{{DEMO_APP}}`, `{{DEPLOY_TARGET}}`, `{{FLEET_CONCURRENCY}}`, …) per
   [`../00-canon-and-variables.md`](../00-canon-and-variables.md).

> **Native vs. layered, in these files:** the workflows' **tests** and **GHAS** steps are 🟩 native;
> the **evals** job is a 🟦 layered pattern; **MCP** tools and **Copilot Spaces** (not shipped here)
> are 🟨 integration/context surfaces. Don't describe evals or A2A as GitHub products.

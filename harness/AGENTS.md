# AGENTS.md — example repo-wide rule file (EXAMPLE — copy to a target repo root)

> **This is a drop-in EXAMPLE.** In the harness home it lives under `harness/` so it does **not**
> govern that repo. To use it, copy this file to the **root** of a target repo as `AGENTS.md` and
> adapt the bracketed parts (the bootstrap step fills them and removes these EXAMPLE notes). It is
> the **static context** every Copilot coding-agent instance loads — the single highest-leverage
> harness artifact (`Agent = Model + Harness`).
>
> **It does not enforce anything by itself.** Real enforcement comes from rulesets, required checks,
> required reviews, and Environments configured in the target repo (see `README.md` here).

---

## 1. What this repo is

`[One-paragraph description of {{DEMO_APP}} — the service, its boundary, its stack. Example default:
a small REST API service. Replace with the target repo's real service.]`

- **Stack:** `[language / framework / runtime]`
- **Run locally:** `[command]`
- **Test:** `[command]` · **Lint:** `[command]` · **Build:** `[command]`

## 2. The discipline — Plan → Validate → Execute (non-negotiable)

1. **Plan first.** No implementation without an approved plan: Issues with acceptance criteria, a
   Definition of Done, a test/eval strategy, and a dependency graph.
2. **Validate the plan.** The plan passes a **rubber-duck / devil's-advocate** review **and** a human
   approval **before any code is written**. This is a hard gate.
3. **Execute** only against a validated, approved plan.

**Never implement an unvalidated plan. Never parallelize dependent units.**

## 3. How you (a Development-fleet agent) must work

- You are assigned **exactly one** parallel-safe Issue. Implement **only** that unit.
- Work on your **own branch**; open **one linked PR** that references the Issue.
- **Do not touch files owned by another unit.** If you discover a cross-unit dependency, stop and
  flag it on the Issue — it means the plan needs re-validation, not a workaround.
- Keep the change minimal and scoped to the Issue's DoD. Do not refactor unrelated code.
- Ensure your PR's tests **and** evals pass; do not weaken a check to make it green.
- **Never merge your own PR.** Humans approve via CODEOWNERS / required review.

## 4. Guardrails — "never do" rules

- Never commit secrets, credentials, or `.env` files. (Secret-scanning push protection is on.)
- Never add an unpinned or unverified dependency; watch for **hallucinated / slopsquatted** packages.
- Never disable, skip, or weaken a required check, test, or eval.
- Never deploy on a red gate; never bypass the merge queue.
- Never make architecture-impacting changes without updating the architecture docs/diagrams.

## 5. Conventions

- **Style:** `[link to style guide / formatter config]`. Match existing code; don't reformat
  unrelated lines.
- **Tests:** colocate with `[test convention]`; every behavior change ships with tests **and** evals.
- **Commits/PRs:** small, focused, linked to an Issue; PR description states what + why + how-verified.
- **Docs:** update `README` / API reference when behavior or interfaces change.

## 6. The harness around you (for reference)

> **Enforcement modes.** The agent/prompt/skill markdown below is the thin template a
> target carries. The runnable **checks** (`checks/scripts/*.mjs`) stay in the harness
> **home** and run locally via `<HARNESS_ROOT>` (see `skills/README.md`). The
> **GitHub-phase** files — `workflows/*.yml`, vendored `ci/scripts/*`, `CODEOWNERS` —
> are added only when you wire required-check enforcement on GitHub; they are **not**
> part of the thin local template.

| Role | Where it's defined |
|---|---|
| Orchestrator / Dispatcher | `.github/agents/orchestrator.agent.md` |
| Planning / Requirements | `.github/agents/planning.agent.md` |
| Development fleet (implements one unit) | `.github/agents/dev-fleet.agent.md` |
| Rubber-Duck / Plan-Validation | `.github/agents/rubber-duck.agent.md` |
| Quality / Test | `.github/agents/quality-test.agent.md` |
| Security / Compliance | `.github/agents/security-compliance.agent.md` |
| Code Review | `.github/agents/code-review.agent.md` |
| Deployment / Validation | `.github/agents/deployment.agent.md` |
| Repeatable procedures | `.github/prompts/*.prompt.md` |
| Project-zero bootstrap | `.github/prompts/bootstrap-environment.prompt.md` → produces `.harness/project.json` |
| Skills (checks agents invoke) | `.github/skills/*.skill.md` (run-tests · check-deps · deploy) |
| Work intake | `.github/ISSUE_TEMPLATE/work-unit.yml` |
| Safety overlay | `.github/instructions/agent-safety.instructions.md` |
| Verification (GitHub phase) | `.github/workflows/tests-and-evals.yml` — *added at the enforcement phase* |
| Security gate (GitHub phase) | `.github/workflows/security-gate.yml` — *added at the enforcement phase* |
| Code ownership (GitHub phase) | `CODEOWNERS` — *added at the enforcement phase* |

> 🔒 **IF HIGH-ASSURANCE.** Add: mandatory multi-party plan + release approval; a dedicated
> Security/Compliance owner; "all security + eval checks green before merge"; stricter rulesets and
> secret-scanning push protection enforced org-wide.

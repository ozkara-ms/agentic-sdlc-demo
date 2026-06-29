# AGENTS.md — example repo-wide rule file (EXAMPLE — copy to a target repo root)

> **This is a drop-in EXAMPLE.** It lives under `docs/agentic-engineering-on-github/harness/` so it
> does **not** govern this demo repo. To use it, copy this file to the **root** of a target repo as
> `AGENTS.md` and adapt the bracketed parts. It is the **static context** every Copilot coding-agent
> instance loads — the single highest-leverage harness artifact (`Agent = Model + Harness`).
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

| Role | Where it's defined |
|---|---|
| Orchestrator / Dispatcher | `.github/agents/orchestrator.agent.md` |
| Planning / Requirements | `.github/agents/planning.agent.md` |
| Rubber-Duck / Plan-Validation | `.github/agents/rubber-duck.agent.md` |
| Quality / Test | `.github/agents/quality-test.agent.md` |
| Security / Compliance | `.github/agents/security-compliance.agent.md` |
| Code Review | `.github/agents/code-review.agent.md` |
| Deployment / Validation | `.github/agents/deployment.agent.md` |
| Repeatable procedures | `.github/prompts/*.prompt.md` |
| Work intake | `.github/ISSUE_TEMPLATE/work-unit.yml` |
| Verification | `.github/workflows/tests-and-evals.yml` |
| Security gate | `.github/workflows/security-gate.yml` |
| Safety overlay | `.github/instructions/agent-safety.instructions.md` |

> 🔒 **IF HIGH-ASSURANCE.** Add: mandatory multi-party plan + release approval; a dedicated
> Security/Compliance owner; "all security + eval checks green before merge"; stricter rulesets and
> secret-scanning push protection enforced org-wide.

# GitHub enforcement — the harness's 🟩 NATIVE gates, made real (R11)

The GitHub-side counterpart to [`../azure/`](../azure/). Where `provision.ps1` builds the Azure target,
`enforce-protections.ps1` configures the **platform primitives that actually block merges and releases**:
Environments, a branch ruleset, required status checks, and required CODEOWNERS review.

This is the difference between the harness *describing* governance (issue forms, `AGENTS.md`, agent files
— social/prompt convention) and GitHub *enforcing* it. Only the ruleset + Environment make a gate **bite**.

## Honest enforcement labels (the demo's core rule)
| Gate | Label | What actually enforces it |
|---|---|---|
| PR required + 1 review + **CODEOWNERS** review | 🟩 **native** | the branch **ruleset** `pull_request` rule + [`CODEOWNERS`](../../../docs/agentic-engineering-on-github/harness/CODEOWNERS) |
| **Required status checks** (tests/evals/path-scope/security) | 🟩 **native** | the ruleset `required_status_checks` rule — but the *checks themselves* are 🟦 our CI |
| **Production** approval (release gate) | 🟩 **native** | the `production` **Environment** required reviewer |
| Merge queue (opt-in) | 🟩 **native** *if available* | the ruleset `merge_queue` rule — **degrades honestly** if the repo/plan can't |
| Live deploy / smoke / rollback | 🟦 **layered** | `deploy.yml` (orchestration) — **deliberately NOT a required pre-merge check** |

The **deploy jobs are intentionally excluded** from required status checks: production deploy is a
*post-merge* Environment gate, not a pre-merge check. Requiring a deploy job pre-merge would be both an
overclaim and a deadlock.

## ⛔ Bootstrap order is load-bearing (gap-review #4 — a ruleset can self-lock the repo)
A required-status-checks rule can only name a check that **already exists**, and a required-PR rule can
block the very push that would create the workflows. So the order is fixed:

1. **(a) push** the harness + workflows to the repo (S1).
2. **(b) trigger** the workflows once — open a throwaway PR — so the check-run **names register**.
3. **(c) run this script.** It **verifies** each required check name has actually appeared in recent
   check-runs and **refuses to require a name that has never run** (unless `-Force`) — so a typo or a
   not-yet-existing context can't brick every future PR.
4. **(d) verify** a deliberately-failing PR is **blocked**, and a clean PR merges.

`enforce-protections.ps1` implements step (c) and prints step (d). Never enable protections before (b).

## Usage
```powershell
# dry-run first (prints every gh api call, mutates nothing):
pwsh ./enforce-protections.ps1 -Repo <your-org>/agentic-sdlc-demo-live -Reviewer <your-username> -DryRun

# apply (after the workflows have run once so the names registered):
pwsh ./enforce-protections.ps1 -Repo <your-org>/agentic-sdlc-demo-live -Reviewer <your-username>

# also try a merge queue (auto-degrades + warns if unavailable):
pwsh ./enforce-protections.ps1 -Repo ... -Reviewer ... -WithMergeQueue

# require checks that haven't registered yet (only if you're sure the names are exact):
pwsh ./enforce-protections.ps1 -Repo ... -Reviewer ... -Force

# teardown the GitHub-side enforcement (ruleset + environments):
pwsh ./enforce-protections.ps1 -Repo ... -Remove
```

## What it configures
* **Environments** — `staging` (auto, no reviewer) + `production` (required reviewer = `-Reviewer`).
* **Ruleset** `agentic-harness-protections` on the default branch:
  * `pull_request` → 1 approving review + `require_code_owner_review` + dismiss-stale-on-push.
  * `required_status_checks` → only the **PR-safe** contexts (the deploy jobs are excluded):
    `Tests (unit)`, `Tests (e2e)`, `Evals (trajectory + rubric)`, `Path-scope (fleet lane check)`,
    `Dependency review (supply-chain)`, `CodeQL (code scanning)`,
    `Hallucinated-dependency / slopsquatting check`.
  * `merge_queue` → only with `-WithMergeQueue`; **graceful-degrade** retries without it on failure.

Idempotent: re-running PUTs the environments and upserts the named ruleset. Secretless: uses your local
`gh` auth only — nothing is stored in the repo.

## Verify it bites (step d)
Open a PR that breaks a unit test → the `Tests (unit)` check goes red + **Required**, and **Merge** stays
disabled until a CODEOWNER approves *and* all required checks pass. A clean, approved PR merges. That live
contrast is the proof the 🟩 native gate enforces — not the YAML existing.

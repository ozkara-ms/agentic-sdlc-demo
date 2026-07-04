---
name: plan-to-issues
description: Materialize a VALIDATED + human-APPROVED local Work Plan into GitHub Issues — one tracking issue plus one work-unit child issue per unit, labelled, dependency-linked, and mapped into .harness/dispatch.json so implementation is driven from Issues. EXAMPLE skill.
owner: orchestrator
---

# Skill: plan-to-issues

> The orchestrator invokes this **once**, at the hand-off from the LOCAL planning phase to the
> GitHub implementation phase: after **planning** produced the plan, **rubber-duck** validated it,
> and the **human approved** it. It turns the approved plan into the durable, GitHub-native
> **work intake** (Issues) — the unit-of-work tracker the rest of the pipeline dispatches from.
> This is the step the first live run skipped (it stayed in `.harness/work-plan.md` and never
> created Issues).

## Preconditions (refuse if any is false)
1. The plan is **rubber-duck validated** AND carries the human **`plan-approved`** signal. Never
   create issues from an unvalidated/unapproved plan.
2. **GitHub enforcement is LIVE** — run the **`verify-gates`** skill first; it must report READY
   (workflows present + required checks + branch protection + CODEOWNERS on the default branch).
   Creating work issues before the gates exist = ungated PRs (the F6 failure). If not READY, stop
   and have the deployment agent wire enforcement first.
3. `.harness/project.json` exists (org/repo/defaultBranch/requiredChecks known).

## Inputs
- The approved plan (`.harness/work-plan*.md` / `.harness/plan.json`): for each unit — `id`, `title`,
  `intent`, `acceptance`, `dod`, `test/eval strategy`, **`declaredPaths`**, **`requiredTest`**,
  optional `acceptanceEval`, the ordered **E2E real-results** unit's live-URL contract, `parallel-safe`,
  `dependsOn`, `modelTier`.
- The `github.org/repo` from `project.json`.

## Procedure
1. **Verify preconditions** (above). If `verify-gates` is not READY, abort and report — do not create issues.
2. **Ensure labels exist** (idempotent): `agentic-work-unit`, `tracking`, and a per-wave label if used.
   `gh label create agentic-work-unit --color BFD4F2 --force` (repeat for the others).
3. **Create the tracking issue** — the plan summary + the unit list + the dependency graph:
   `gh issue create --repo <org>/<repo> --title "[plan] <intent>" --label tracking --body <plan-summary.md>`.
   Capture its number `T`.
4. **Create one child issue per unit**, body mirroring the **work-unit** fields (the `ISSUE_TEMPLATE/
   work-unit.yml` form is for manual UI creation; programmatic creation writes the same sections):
   ```bash
   gh issue create --repo <org>/<repo> --label agentic-work-unit \
     --title "[unit] <id>: <title>" \
     --body "## Intent
   <intent>
   ## Acceptance criteria
   <acceptance>
   ## Definition of Done
   <dod>
   ## Test + eval strategy
   <test/eval>
   ## Declared paths (lane)
   <declaredPaths, one per line>
   ## Required test (trajectory)
   <requiredTest>
   ## Acceptance eval contract
   <acceptanceEval or 'n/a'>
   ## E2E real-results contract
   <live-URL contract — REQUIRED for the ordered e2e unit, else 'n/a'>
   ## Parallel-safe?
   <Yes | No — depends on: …>
   ## Tracking
   Part of #<T>"
   ```
   Record each unit's issue number. Create the **E2E real-results unit** as an ordered issue last.
5. **Wire dependencies** — now that child numbers exist, edit each unit's body/`dependsOn` to reference
   the real issue numbers (e.g. `Depends on #12, #13`), and link them on the tracking issue's task list
   (`- [ ] #<n> <id>`). The path-scope + dependency graph stays the source of truth.
6. **Write the dispatch map** `.harness/dispatch.json`: `{ trackingIssue: T,
   fallbackImplementation:{preApproved:false, approvedBy:"", at:""}, units: [{id, issue,
   implementer:"unassigned", actorId:"", branch:"", pr:0, session:"", status:"queued",
   dependsOn:[issue numbers]}] }`. `fallbackImplementation.preApproved` stays **false** unless the human
   explicitly pre-approved a local dev-fleet fallback at the plan-approval gate; `actorId` records the resolved
   `BOT_…` id once the cloud agent is assigned. This is what the orchestrator polls + updates (pull-observable,
   the F8 discipline) so implementation is driven from Issues, not chat.
7. **Output**: the tracking issue `#T` + the child issue numbers + the dispatch map. The orchestrator now
   dispatches each ready unit by **assigning its issue to the Copilot cloud agent (the REQUIRED default)** — a
   dev-fleet subagent is used only as a **human-pre-approved fallback** once cloud dispatch is proven
   unavailable. The assigned implementer opens a gated PR that closes the issue on merge.

## Assigning the Copilot cloud agent (use GraphQL assignment, NOT mentions or `--add-assignee copilot`)
An `@copilot` issue comment/mention is **not** the launch mechanism. Dispatch launches the cloud agent by assigning
the work-unit Issue to the assignable Bot `copilot-swe-agent` via GraphQL, then records that implementer in
`.harness/dispatch.json` and polls GitHub for the resulting branch/PR/checks.

The REST assignee API does **not** recognize the login `copilot`/`Copilot` → `gh issue edit <n> --add-assignee
copilot` returns **HTTP 404**, which looks like "the bot lacks repo access" but usually isn't. Copilot is
assignable when it appears in the repo's `suggestedActors(capabilities:[CAN_BE_ASSIGNED])` as the **Bot
`copilot-swe-agent`**. Assign it via the GraphQL mutation using that Bot's node id:
```bash
# 1) confirm Copilot is assignable + get its node id
gh api graphql -f query='query($o:String!,$r:String!){ repository(owner:$o,name:$r){
  suggestedActors(capabilities:[CAN_BE_ASSIGNED],first:20){ nodes{ login __typename ... on Bot{ id } } } } }' \
  -f o=<org> -f r=<repo>
# 2) get the issue node id
gh api graphql -f query='query($o:String!,$r:String!,$n:Int!){ repository(owner:$o,name:$r){ issue(number:$n){ id } } }' \
  -f o=<org> -f r=<repo> -F n=<issue-number>
# 3) assign (replaceActorsForAssignable with the copilot-swe-agent Bot id)
gh api graphql -f query='mutation($a:ID!,$ids:[ID!]!){ replaceActorsForAssignable(input:{assignableId:$a,actorIds:$ids}){
  assignable{ ... on Issue{ number assignees(first:5){ nodes{ login } } } } } }' \
  -f a=<issue-node-id> -f ids=<copilot-swe-agent-bot-id>
```
If `suggestedActors` does **not** list `copilot-swe-agent`, THEN the coding agent is genuinely not enabled —
enable it via the org/repo Copilot policy. The cloud agent opens a branch `copilot/*` and a PR authored by
`app/copilot-swe-agent` (a non-human identity → the human CODEOWNER can approve it, dissolving the QF7
self-approval deadlock; and it runs in its own GitHub-Actions env → no local shell/git tooling gap, QF3).

Immediately after a successful mutation, update the unit entry in `.harness/dispatch.json` to
`implementer:"copilot-swe-agent"`, `status:"assigned"`, and keep `branch`/`pr` blank until observed. Then poll
durable GitHub signals (`gh issue view`, `gh pr list`, check runs/status checks) until the branch, PR, and checks
appear; never wait for a chat acknowledgement as proof of launch.

## Honesty rules (hard)
- **Never create work issues before `verify-gates` is READY** — ungated issues produce ungated PRs (F6).
- **Never create issues from an unvalidated or unapproved plan** — the rubber-duck + human gate comes first.
- Mirror the work-unit fields faithfully; an issue missing `declaredPaths`/`requiredTest`/DoD breaks the
  downstream path-scope + trajectory gates. The ordered **E2E unit must carry the live-URL contract**.
- Record the unit→issue map in `.harness/dispatch.json` so status is pull-observable (no fire-and-forget).
- Never treat an `@copilot` mention/comment as dispatch; only the GraphQL assignment to `copilot-swe-agent`
  launches the cloud implementation worker.
- **Resolve the `copilot-swe-agent` Bot node id from `suggestedActors` at dispatch time** (a `BOT_…` id on the
  target repo). Never hardcode it, cache it across runs, or use a global user-search node (`U_…` from
  `search(type:USER)`) — the wrong id makes `replaceActorsForAssignable` fail, and that failure must NOT be
  treated as license to implement the unit locally (local fallback needs explicit human pre-approval).

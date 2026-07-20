# 02 · The Agents, their Skills & the Harness

> Deliverable 2. First the **Harness Configuration Map** (the harness is real and versioned like
> code), then the **reference roster** of agents and the gate each owns, then three design notes,
> then the **enforcement-boundary map**. Vocabulary, roster names, and the 🟩/🟦/🟨 labels are frozen
> in [`00-canon-and-variables.md`](./00-canon-and-variables.md). The "Concrete GitHub artifact"
> column matches the drop-in files in [`harness/`](./harness/).

---

## Part 1 — Harness Configuration Map

**Agent = Model + Harness.** Below, each harness component is mapped to the concrete GitHub artifact
that implements it. Everything in the right-hand columns is a file or a platform setting — **the
harness is versioned like code.**

| Harness component | Concrete GitHub artifact | Label | Lives in `harness/` |
|---|---|---|---|
| **Instructions / rule files** (static context, persona) | `AGENTS.md` (repo-wide + nested per-dir); `.github/copilot-instructions.md`; path-scoped `.github/instructions/*.instructions.md` | 🟩 | `AGENTS.md` |
| **Tools** | GitHub-native tools (Actions, `gh`, the API); external tools **exposed via MCP servers** | 🟩 native + 🟨 MCP | *(MCP referenced, not shipped)* |
| **Sandboxes / execution environments** | **Copilot coding agent** isolated env (one per assigned Issue → branch → PR); **Actions runners** (GitHub-hosted + **self-hosted** for local/on-prem) | 🟩 | *(platform; referenced)* |
| **Orchestration — roles** | **Custom agents** `.github/agents/<name>.agent.md` | 🟩 | `agents/*.agent.md` |
| **Orchestration — repeatable procedures** | **Prompt files** `.github/prompts/*.prompt.md` | 🟩 | `prompts/*.prompt.md` |
| **Orchestration — fleet dispatch** | Assigning **multiple Issues** to the Copilot coding agent at once (concurrent env/branch/PR each) | 🟩 | *(action, not a file)* |
| **Orchestration — model routing** | Premium vs. cheaper model selection per agent/gate *(see Note C)* | 🟦 strategy over 🟩 model-selection config | *(per-agent note)* |
| **Orchestration — cross-agent handoff (A2A)** | **Convention**: Issues, sub-issues, PR links, labels, check outputs | 🟦 pattern | encoded in `agents/*` + `ISSUE_TEMPLATE/` |
| **Guardrails / hooks** | `AGENTS.md` "never do" rules; **rulesets / branch protection**; **required status checks**; **required reviews** + **CODEOWNERS**; **secret-scanning push protection**; **Environments** protection rules | 🟩 + 🟦 evals-as-checks | `AGENTS.md`, `workflows/*.yml` |
| **Verification — tests** | Test jobs in **Actions** (matrix + concurrency) | 🟩 | `workflows/tests-and-evals.yml` |
| **Verification — evals** | **Actions jobs** running rubric / trajectory / LM-judge steps + regression suites, wired as **required checks** | 🟦 pattern | `workflows/tests-and-evals.yml` |
| **Verification — security** | **GHAS**: CodeQL, secret scanning, Dependabot/Advisory DB, **Copilot Autofix**; coding-agent baseline scan | 🟩 | `workflows/security-gate.yml` |
| **Observability / audit** | **Actions logs**; **deployment history**; **security overview**; **Copilot usage metrics** | 🟩 | *(platform; referenced)* |
| **Work intake** | **Issue forms** (`.github/ISSUE_TEMPLATE/*.yml`); **Projects** | 🟩 | `ISSUE_TEMPLATE/work-unit.yml` |

> **Read the labels.** 🟩 native GitHub products; 🟦 patterns you build on top (evals, A2A); 🟨
> integration/context surfaces that inform but do not enforce (MCP, Spaces). See `00` §6.

---

## Part 2 — The reference roster

Eight roles. Each owns one **gate**. For each: responsibility, skills (and how they're encoded),
the primary context types it leans on (of the six), the GitHub primitives it uses, inputs, outputs,
the A2A handoff it performs, the human checkpoint, its "never-do" guardrails, and the verification
it applies.

> **Skills are Agent Skills.** Each agent's skills are portable procedural knowledge loaded by
> **progressive disclosure** — encoded as `AGENTS.md` sections, a `.github/agents/*.agent.md`
> persona, a `.github/prompts/*.prompt.md` procedure, or an MCP tool. A lightweight generalist
> flexes into each specialist role by loading the relevant skill, not by carrying every skill at once.

### 0 · Orchestrator — *gate: intent & accountability* (human, optionally assisted)
| | |
|---|---|
| **Responsibility** | Owns the intent; **decomposes** work into parallel-safe units + a dependency graph; **dispatches the fleet**; manages **fan-in**/integration and sequencing; accountable approver at every human gate. Drops into **Conductor** mode in the IDE for the hard 20%. |
| **Skills + encoding** | Decomposition & dependency-graphing (`prompts/decompose-intent.prompt.md`); fleet dispatch (assigning multiple Issues); judgment at gates *(human)*. |
| **Context types** | Instructions, Knowledge, Memory *(the product/domain context the agents lack)*. |
| **GitHub primitives** | Issues/sub-issues, Projects, Copilot coding-agent assignment, merge queue, Environments. |
| **Inputs / Outputs** | In: a sentence of intent. Out: a decomposed Work Plan request + dispatched fleet + approvals. |
| **A2A handoff** | Opens the tracking Issue; hands to **Planning** via issue assignment. |
| **Human checkpoint** | **Is** the human. Approves plan, PRs, release. |
| **Guardrails (never do)** | Never dispatch a fleet against an **unvalidated** plan; never parallelize **dependent** units; never approve past a red required check. |
| **Verification** | Confirms each downstream gate is green before approving. |

### 1 · Planning / Requirements Agent — *gate: well-formed work*
| | |
|---|---|
| **Responsibility** | Turns intent into a **Work Plan**: a set of Issues, each with **acceptance criteria + a Definition of Done + a test/eval strategy**, plus a **dependency graph** marking parallel-safe vs. ordered units. |
| **Skills + encoding** | Requirement elicitation, DoD authoring, decomposition (`agents/planning.agent.md` + `prompts/decompose-intent.prompt.md`); issue intake shape (`ISSUE_TEMPLATE/work-unit.yml`). |
| **Context types** | Instructions, Knowledge, Examples. |
| **GitHub primitives** | Issues, sub-issues, issue forms, issue types, Projects. |
| **Inputs / Outputs** | In: intent + product context. Out: tracking Issue + child Issues + dependency graph (as an issue/Project artifact). |
| **A2A handoff** | Posts the plan to the tracking Issue; hands to **Rubber-Duck** for validation. |
| **Human checkpoint** | Orchestrator reviews scope before validation. |
| **Guardrails (never do)** | Never emit an Issue without acceptance criteria + DoD + a test/eval strategy; never assert a parallel-safe edge it can't justify. |
| **Verification** | Self-check that every Issue is independently testable. |

### 2 · Rubber-Duck / Plan-Validation Agent — *gate: validated plan* **(HARD GATE, before any code)**
| | |
|---|---|
| **Responsibility** | Plays **devil's advocate** against the plan and decomposition: logic flaws, **hidden cross-unit dependencies**, missing edge cases, **unsafe parallelization**, ambiguous specs, scope gaps. Returns required revisions; loops until sound. |
| **Skills + encoding** | Adversarial plan review (`agents/rubber-duck.agent.md` + `prompts/validate-plan.prompt.md`). |
| **Context types** | Instructions, Knowledge, Guardrails. |
| **GitHub primitives** | Issue/PR comments, a **plan-approved label**, and (optionally) a merge-time status check. |
| **Inputs / Outputs** | In: the Work Plan + graph. Out: a validation verdict (PASS / revisions) as a **comment + plan-approved label** that the dispatcher gates on. |
| **A2A handoff** | On PASS, signals the **Orchestrator** for human approval; only then does **Development** begin. |
| **Human checkpoint** | ⛔ **Human approves the plan** after the agent passes it. |
| **Guardrails (never do)** | Never approve a plan it can't stress-test; never let implementation start before PASS **and** human approval. |
| **Verification** | Its output *is* up-front verification of intent — the cheapest test in the pipeline. |

### 3 · Development Agent (Fleet) — *gate: working implementation*
| | |
|---|---|
| **Responsibility** | A **fleet** of **GitHub Copilot coding agent** instances, each assigned **one parallel-safe Issue**, each implementing on **its own branch** and opening **its own linked PR**, concurrently. Dependent units wait per the graph. **Conductor** mode (Copilot in the IDE) handles ambiguous slices. |
| **Skills + encoding** | Repo conventions + "never do" rules in **`AGENTS.md`** (the coding agent obeys it); user-facing UI units additionally load **`skills/frontend-design.skill.md`** for an intentional design direction, complete interaction states, responsiveness, and accessibility. This role is **native**, so it's configured primarily by rule and skill files rather than a custom persona file. |
| **Context types** | Instructions, Knowledge, Tools. |
| **GitHub primitives** | 🟩 Copilot coding agent (isolated env/branch/PR; concurrent assignment); auto **CodeQL + secret scanning + dependency review + quality self-review** on its own code (baseline — **no GHAS license required**). |
| **Inputs / Outputs** | In: one approved, parallel-safe Issue. Out: a branch + a linked PR with a self-review. |
| **A2A handoff** | Opens a PR that **closes/links** its Issue; hands to **Quality**, **Security**, **Review** gates. |
| **Human checkpoint** | None mid-implementation; humans gate at PR review. |
| **Guardrails (never do)** | Never start before plan approval; never touch another unit's files; never merge its own PR. |
| **Verification** | Built-in quality self-review + baseline scans before the PR is marked ready. |

### 4 · Quality / Test Agent — *gate: functional correctness*
| | |
|---|---|
| **Responsibility** | Per PR, **in parallel**: authors **tests** (unit + e2e) **and evals** (trajectory + output rubrics / LM-judge) that encode the DoD; runs them via Actions; validates the build. Owns *"does each unit do what its Issue asked, reliably?"* |
| **Skills + encoding** | Test + eval authoring (`agents/quality-test.agent.md`); execution (`workflows/tests-and-evals.yml`, matrix + concurrency). |
| **Context types** | Instructions, Examples, Tools. |
| **GitHub primitives** | 🟩 Actions matrix/concurrency, **required status checks**; 🟦 evals as Actions jobs. |
| **Inputs / Outputs** | In: a PR + its Issue's DoD. Out: green/red tests **and** evals as required checks. |
| **A2A handoff** | Reports check status on the PR; co-gates with Security + Review. |
| **Human checkpoint** | Reviewer sees check results before approving. |
| **Guardrails (never do)** | Never pass a PR on tests alone (**evals required**); never weaken a check to make it green. |
| **Verification** | *Is* the verification gate: Tests + Evals. *"Set the bar at the eval, not the demo."* |

### 5 · Security / Compliance Agent — *gate: safe & auditable*
| | |
|---|---|
| **Responsibility** | Per PR, **in parallel**: triages **GHAS** findings (CodeQL, secret scanning, Dependabot), applies/validates **Copilot Autofix**, threat-models architecture-impacting changes, checks license/IP and supply-chain (**hallucinated-dependency / slopsquatting** risk), and produces **compliance evidence**. |
| **Skills + encoding** | Security triage + supply-chain checks (`agents/security-compliance.agent.md`); gate job (`workflows/security-gate.yml`). |
| **Context types** | Instructions, Knowledge, Guardrails. |
| **GitHub primitives** | 🟩 CodeQL, secret scanning + push protection, Dependabot/Advisory DB, Copilot Autofix, security overview. |
| **Inputs / Outputs** | In: a PR + scan results. Out: triaged findings, applied fixes, a security gate status + evidence. |
| **A2A handoff** | Reports security status on the PR; blocks merge when wired as a required check. |
| **Human checkpoint** | Security owner reviews high-severity findings. |
| **Guardrails (never do)** | Never auto-dismiss a finding without rationale; never add an unverified/unpinned dependency. |
| **Verification** | Scans + Autofix validation + supply-chain check as a gating job. |

### 6 · Code Review Agent — *gate: quality & architecture*
| | |
|---|---|
| **Responsibility** | Per PR: **GitHub Copilot code review** (AI first pass) **plus** a custom reviewer — code quality/standards, README/docs updates, and **architecture-impact detection** (update architecture docs/diagrams when affected). Posts comments for human sign-off. |
| **Skills + encoding** | Review heuristics + docs/architecture checks (`agents/code-review.agent.md`); native Copilot code review. |
| **Context types** | Instructions, Knowledge, Examples. |
| **GitHub primitives** | 🟩 Copilot code review (**advisory**), PR review comments, **CODEOWNERS**, required reviews. |
| **Inputs / Outputs** | In: a PR. Out: review comments + a docs/architecture-impact note. |
| **A2A handoff** | Requests changes back to **Development**; hands clean PRs to the human approver. |
| **Human checkpoint** | ⛔ **Human approves via CODEOWNERS / required review.** |
| **Guardrails (never do)** | Never treat the advisory AI review as the merge gate by itself; never approve undocumented architecture changes. |
| **Verification** | Review + docs/architecture consistency check. |

### 7 · Deployment / Validation Agent — *gate: release readiness*
| | |
|---|---|
| **Responsibility** | After fan-in/integration, deploys to **`{{DEPLOY_TARGET}}`** via Actions + Environments, runs **smoke tests**, generates **synthetic traffic/load**, reports health and a **go/no-go** signal; supports **automated rollback**. |
| **Skills + encoding** | Deploy + smoke + traffic + rollback (`agents/deployment.agent.md`); deploy workflow *(target-specific)*. |
| **Context types** | Instructions, Tools, Memory *(last-good release)*. |
| **GitHub primitives** | 🟩 Actions deploy workflows, **Environments** (required reviewers / wait timers / deployment protection rules), **self-hosted runners** for local/on-prem, deployment history. |
| **Inputs / Outputs** | In: the integrated, merged result. Out: a deployment + smoke/traffic report + go/no-go. |
| **A2A handoff** | Reports results back to the plan/Issues/PRs, closing the traceability loop. |
| **Human checkpoint** | ⛔ **Environment protection: human approves the release.** |
| **Guardrails (never do)** | Never deploy on a red gate; never skip smoke tests; always keep rollback ready. |
| **Verification** | Smoke tests + synthetic traffic + health checks gate the go/no-go. |

---

## Part 3 — Three design notes

### Note A — Security vs. QA are distinct gates (do not blend them)
QA (functional correctness via **tests + evals**) and Security/Compliance (safety, supply-chain,
compliance evidence) have **different tools and different failure modes** — a feature can be perfectly
correct and dangerously insecure, or hardened and broken. Do not merge their judgment into one gate.
Per the harness principle, at **low maturity** prefer implementing several gates as **Agent Skills +
sub-agents on one shared harness** to avoid multi-agent operational overhead; **split into dedicated
agents** only as scale and governance demand.

> 🔒 **IF HIGH-ASSURANCE.** Split **Security / Compliance** out as a dedicated agent **from day one**,
> with its own owner, its own required checks, and its own evidence trail. Do not let it ride inside
> the QA gate.

### Note B — Fleet safety
Parallelism is safe **only** when the dependency graph is respected. **Never parallelize dependent
units.** Cap concurrency at **`{{FLEET_CONCURRENCY}}`** (see `00` §2 for the default). Use the **merge queue** for
integration. Treat the **rubber-duck plan-validation gate** as the thing that makes fan-out safe —
it is cheaper to catch a bad decomposition before the fleet runs than to untangle N divergent
branches after. See [`03`](./03-github-pipeline.md) for failure handling (failed agent, conflicting
PRs, stale plans, duplicate work, merge-order dependencies).

### Note C — Model routing (an OpEx lever)
Route premium models to the gates where reasoning quality compounds — **planning, architecture,
implementation** — and cheaper models to the high-volume, lower-variance gates — **test/eval
generation, review, CI/security-monitoring**. **Context engineering** (high-signal, low-token
payloads via progressive disclosure) is the other half of the lever: a tight `AGENTS.md` and a
loaded-on-demand skill cost less *and* perform better than one bloated prompt.

| Gate | Typical model tier | Why |
|---|---|---|
| Planning, Rubber-Duck, Development | **Premium** | Reasoning quality compounds downstream |
| Quality/Test, Security triage, Code Review, Deployment monitoring | **Cheaper** | High volume, more deterministic, narrower scope |

---

## Part 4 — Enforcement-boundary map

Which gates **actually block**, and by what mechanism (see `00` §7). This is the difference between a
governance story and a governance *theatre*.

| Gate / control | Enforcement tier | Mechanism |
|---|---|---|
| Plan validation (Rubber-Duck) | **🟦 Layered orchestration gate** | Human plan approval (label/comment) + **dispatch automation** fans out only approved plans. GitHub does **not** natively block pre-code work; a required check can additionally block the *merge* of unapproved-plan work |
| Tests | **Actions-based** → Hard when required | `tests-and-evals.yml` as a **required status check** |
| Evals (🟦 pattern) | **Actions-based** → Hard when required | Eval job in `tests-and-evals.yml` as a **required status check** |
| Security / Compliance | **Actions-based + native** → Hard when required | `security-gate.yml` + GHAS as **required checks**; push protection blocks secrets |
| Code review | **Hard GitHub** | **Required reviews** + **CODEOWNERS** (the AI review itself is 🟨 advisory) |
| Merge / integration | **Hard GitHub** | **Merge queue** + **rulesets / branch protection** |
| Release | **Hard GitHub** | **Environment** protection rules (required reviewers / wait timers) |
| `AGENTS.md`, agent files, prompts, issue form | **Social / prompt convention** | Shapes behavior; **does not block** on its own |

> **The load-bearing caveat (repeated in `harness/README`):** the files in `harness/` shape behavior
> but **do not enforce governance by themselves**. Enforcement is real only when checks/reviews are
> marked **required** and **rulesets / Environments** are configured in the target repo.

---

*Next: [`03 · The GitHub-Powered Pipeline`](./03-github-pipeline.md) — one intent through phases
A–D, in fleet mode, with traceability, economics, and honest limits. The drop-in artifacts live in
[`harness/`](./harness/).*

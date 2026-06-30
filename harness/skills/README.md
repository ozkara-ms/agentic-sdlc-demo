# `harness/skills/` — the repeatable procedures agents invoke (NO custom dispatcher)

A **skill** is a small, repeatable procedure an agent runs to do one job: run a
unit's tests, check its dependencies, or deploy it. Each skill is plain markdown
the agent runtime reads — exactly like `agents/` and `prompts/`. The skill does
**not** contain the gate logic; it **wraps** the runnable check under
`harness/checks/scripts/*` (the single source of truth) and tells the agent how to
invoke it and how to read the result **honestly**.

## Why skills exist (the "no dispatcher" model)

The harness has a custom dispatcher (`_internal/harness-selftest/orchestrator/`) that proves the
fan-out logic offline. **You do not need it to run a real build.** The same
`AGENTS.md` + `agents/` + `prompts/` + **`skills/`** drive both runtimes:

| | **Local** (Copilot CLI / sub-agents) | **GitHub** (`@copilot` + Actions) |
|---|---|---|
| Who runs the skill | the quality / security / deployment **agent** | the required **workflow** under `workflows/` |
| What it executes | the SAME `checks/scripts/*` script | the SAME `checks/scripts/*` script |
| What blocks a bad change | the agent reports honestly + a human gate | the required status check |

A skill is the bridge: an agent reads the skill, runs the wrapped check on the
**real diff / real test**, and reports the result. The `.mjs`/`.py` check is the
authority; the skill is the instruction sheet.

## The skills

| Skill | Wraps (source of truth) | Owner agent |
|---|---|---|
| [`run-tests`](run-tests.skill.md) | the unit's `requiredTest` + `checks/scripts/trajectory-check.mjs` + `eval-rubric.mjs` | quality-test |
| [`check-deps`](check-deps.skill.md) | `checks/scripts/pin-check.mjs` | security-compliance |
| [`deploy`](deploy.skill.md) | container build + `checks/scripts/smoke-check.mjs` + `checks/lib/run-status.mjs` | deployment |

## Honesty rules (apply to every skill)

- **Never fake a green.** A skipped, empty, mocked, or "not applicable" result is
  **not** a pass. Report it as exactly what it is.
- **Run the wrapped check on the real artifact** (the actual diff / built app /
  deployed instance) — never on a placeholder.
- **Report the enforcement label** the check emits (🟩 native / 🟦 layered /
  🟨 advisory / ⛔ external) so nothing reads stronger than it is.
- **Polyglot:** skills are ecosystem-agnostic. They read the unit's declared
  `requiredTest` / manifest and pass `--ecosystem node|python` to the check; the
  check (not the skill) owns the language-specific logic.

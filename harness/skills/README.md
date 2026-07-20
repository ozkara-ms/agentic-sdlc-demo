# `harness/skills/` — the repeatable procedures agents invoke (NO custom dispatcher)

A **skill** is a small, repeatable procedure an agent runs to do one job: preflight
a workspace, design a frontend, run tests, check dependencies, or deploy. Each skill
is plain markdown the agent runtime reads — exactly like `agents/` and `prompts/`.
Some skills **wrap** runnable checks; others shape orchestration or implementation
craft. A craft skill never claims to be an enforcement gate.

## Where gate-wrapper LOGIC lives (and where it does NOT)

For skills that wrap gates, the runnable checks (`checks/scripts/*.mjs`,
`checks/lib/*.mjs`) are the harness's **engine**. They live in the **harness home
repo** — they are **NOT** copied into a target. A target carries only the markdown
(`AGENTS.md` + `agents/` + `prompts/` + `skills/`). So a gate-wrapper skill
references a check through a location variable, not a path that must exist in the
target:

- **`<HARNESS_ROOT>`** = the path to the harness home's `harness/` directory. In
  **LOCAL** mode the orchestrator sets it (e.g. `…/agentic-sdlc-demo/harness`) and
  the skill runs `node <HARNESS_ROOT>/checks/scripts/<check>.mjs` against the
  target's **real git diff**.

## The two enforcement modes (the same check, swapped runtime)

| | **LOCAL** (Copilot CLI / sub-agents) — now | **GitHub** (`copilot-swe-agent` + Actions) — added at the enforcement phase |
|---|---|---|
| Who runs the check | the quality / security / deployment **agent**, from the harness home | the required **workflow** |
| How it's invoked | `node <HARNESS_ROOT>/checks/scripts/<check>.mjs` | the check is **vendored** to the target (`ci/scripts/<check>.mjs`) at push time and called by `.github/workflows/*.yml` |
| What blocks a bad change | the agent reports honestly + a human gate | the required status check |

> **The target never carries `checks/`.** Locally the engine stays in the harness
> home; on GitHub it is vendored into `ci/scripts/` only when you wire enforcement
> (see the harness home's `checks/README.md` "Tier-2 instantiation" mapping). The
> `.github/workflows/*.yml`, `ci/scripts/*`, and `CODEOWNERS` files are therefore
> **added at the GitHub-enforcement phase**, not part of the thin local template.

## The skills

| Skill | Procedure / wrapped engine | Owner agent |
|---|---|---|
| [`workspace-hygiene`](workspace-hygiene.skill.md) | current-branch + stale-run-artifact preflight | orchestrator |
| [`workplace-intake`](workplace-intake.skill.md) | WorkIQ/M365 intake with a human-pasted fallback | orchestrator |
| [`frontend-design`](frontend-design.skill.md) | intentional UI design + production implementation procedure; verified by required tests/UI E2E | dev-fleet |
| [`run-tests`](run-tests.skill.md) | the unit's `requiredTest` + `<HARNESS_ROOT>/checks/scripts/trajectory-check.mjs` + `eval-rubric.mjs` | quality-test |
| [`check-deps`](check-deps.skill.md) | `<HARNESS_ROOT>/checks/scripts/pin-check.mjs` | security-compliance |
| [`deploy`](deploy.skill.md) | container build + `<HARNESS_ROOT>/checks/scripts/smoke-check.mjs` + `checks/lib/run-status.mjs` | deployment |
| [`verify-gates`](verify-gates.skill.md) | `deploy/github/enforce-protections.ps1` + live GitHub configuration inspection | deployment |
| [`plan-to-issues`](plan-to-issues.skill.md) | validated, human-approved plan → GitHub Issues + dispatch map | orchestrator |

## Honesty rules (apply to every skill)

- **Never fake a green.** A skipped, empty, mocked, or "not applicable" result is
  **not** a pass. Report it as exactly what it is.
- **Use the real artifact.** Gate wrappers run on the actual diff / built app /
  deployed instance; craft skills operate on the real interface, not a placeholder.
- **Report the enforcement boundary.** Include the label a check emits (🟩 native /
  🟦 layered / 🟨 advisory / ⛔ external). A craft procedure such as
  `frontend-design` is behavior-shaping; only its tests, UI E2E, and configured
  review controls provide evidence or enforcement.
- **Polyglot:** skills are ecosystem-agnostic. They read the unit's declared
  `requiredTest` / manifest and pass `--ecosystem node|python` to the check; the
  check (not the skill) owns the language-specific logic.

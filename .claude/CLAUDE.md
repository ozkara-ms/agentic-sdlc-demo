# Claude Code — Project Config

> Read `AGENT.md` for project instructions (auto-loaded via root `CLAUDE.md`).
> `AGENT.md` § Workflow Rules and § Platform & Environment hold the project's working rules.

## Claude-Specific

- Use subagents (`explore`, `task`) for research and verbose long-running work; keep main context for decisions and code edits only.
- When proposing code changes, verify locally before claiming done — run the checks in `AGENT.md` § **How to Verify**; keep that section current as the project evolves.
- Update the **Project Context** block below at session end with the active iteration's status — what changed, what's next.
- Durable lessons go to your team wiki, NOT to a project-local `.ai/` folder.

## Project Context

Agentic SDLC Demo is a presenter-led, reusable demo environment that showcases the full software development lifecycle driven by AI coding agents — from a raw input (a requirement, meeting notes, or an action item) through plan → implement → test → review → PR → deploy. Scaffolded 2026-06-18 from `project-template`. It is a customer-facing showcase, NOT a hands-on lab: the presenter drives, the audience watches the agentic workflow. First-session task: research demoable agentic-SDLC surfaces (Copilot CLI + coding agent + PR review, Claude Code, GitHub Actions, Azure deploy) and propose the sample app + the input→lifecycle story before building anything (see `AGENT.md` § First Session Instructions). Durable project knowledge lives in your team wiki.

**Iteration status:** Tier-1 offline backbone complete and green — sample app + multi-agent gate harness + dispatcher, validated by `node demos/validate/run.mjs` (every gate catches its seeded negative). The live path (a public companion repo + Azure Container Apps) is designed and hardened: a **secretless dual-plane** release (OIDC control plane + AcrPull managed-identity data plane; non-secret IDs in repo Variables), ACR deploy-by-digest with both rollback variants, issue-native plan-lint, and CODEOWNERS + idempotent ruleset/Environment automation. The harness defines the live real-results E2E (a human meta-verifies; the coding agent authors). See `AGENT.md` § **How to Verify** for current checks and `demos/HARNESS_TESTING.md` for the test-and-improve loop.

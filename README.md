# Agentic SDLC Demo

A ready-to-run, **presenter-led demo environment** that showcases the full software development lifecycle driven by AI coding agents.

Feed it a real-world **input** — a new requirement, meeting notes, or an action item — and the agent takes it through the entire lifecycle live:

**intake → plan & design → implement → test → review → pull request → deploy & docs**

Each stage is a self-contained "functionality" the presenter can demo on its own, or chain into one continuous end-to-end story. It is a **customer-facing showcase, not a hands-on lab** — the presenter drives, the audience watches the agentic workflow in action.

## Status

Scaffolded 2026-06-18 from `project-template`. Not started — the first working session researches the topic and proposes the demo plan (sample app, input→lifecycle story, per-stage flows, fallback). See `AGENT.md` § **First Session Instructions**.

## Layout

| Path | Description |
|------|-------------|
| `AGENT.md` | Main AI instructions — overview, demo concept, deliverables, how-to-verify, first-session plan |
| `harness/` | The reusable, published agent-harness template (agents · prompts · skills · checks · workflows) |
| `_internal/harness-selftest/` | Local-only self-test rig (sample-app · scenarios · validator) — gitignored |
| `docs/` | Talking points, setup, fallback plan, the narrative |
| `inputs/` *(first session)* | Seed artifacts: sample requirement / meeting notes / action item |
| `app/` *(first session)* | The sample application the agent evolves during the demo |

## Getting started

```pwsh
git clone https://github.com/<your-org>/agentic-sdlc-demo.git
cd agentic-sdlc-demo
```

Open the repo with your preferred AI coding agent (for example GitHub Copilot CLI or Claude Code). On first launch, ask the agent to research agentic-SDLC capabilities and propose the demo plan before building anything.

## Reference

Project overview, demo concept, and how-to-verify live in `AGENT.md`.

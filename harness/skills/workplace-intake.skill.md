---
name: workplace-intake
description: Retrieve a Teams/email/meeting requirement through Microsoft 365 context when the tool exists, or stop cleanly for a pasted intake when it does not. EXAMPLE skill.
owner: orchestrator
---

# Skill: workplace-intake

> The orchestrator invokes this when the source requirement lives in Teams, email, a meeting, or another
> Microsoft 365 workplace artifact.

## When to invoke
- At intake when the user says the demand is in Teams, email, chat, a meeting, or a document.
- Before writing `docs/INTENT.md` from workplace context.
- Any time a run refresh needs the latest workplace requirement instead of an existing local intent file.

## Tool-surface rule
WorkIQ/Microsoft 365 Copilot query tools are host-dependent. Use the query tool that is **actually exposed in the
current session**. Known surfaces include:

- `workiq-ask` in Copilot CLI tool lists.
- `ask_work_iq` in older WorkIQ skill examples.
- Other WorkIQ/M365 Copilot wrappers in some hosts.

Do **not** invent a missing tool name and do **not** assume the query tool exists just because the WorkIQ skill
instructions loaded. If no M365 query tool is available, report `INTAKE-BLOCKED: M365 query tool unavailable in
this session`, ask the human to relaunch the local orchestrator with the full-tool harness profile or paste the
requirement, and stop. Do not ask the loop/observer to retrieve the demand for you. Do not proceed from a guessed
requirement, stale `docs/INTENT.md`, or stale `.harness` artifacts.

## Procedure
1. Identify the source hint: Teams topic, chat name, sender, date, meeting title, email subject, or document name.
2. Query M365 Copilot with a narrow question that asks for the exact latest demand plus source metadata.
3. If the result is ambiguous or multiple demands match, ask the human to choose the correct source before
   planning.
4. Write a fresh `docs/INTENT.md` that includes:
   - source kind (`Teams`, `email`, `meeting`, `document`, or `human-pasted fallback`);
   - source topic/title, sender, date/time, and link when available;
   - exact demand text or a faithful structured summary;
   - explicit non-goals and constraints.
5. Record enough provenance in the plan/run artifacts so `workspace-hygiene` can tell this intake from a previous
   scenario.

## Honesty rules
- Never say "retrieved from Teams" unless a workplace query actually succeeded or the human provided the text with
  that provenance.
- Never silently fall back to an older `docs/INTENT.md`.
- Never continue to planning on an unavailable or ambiguous intake. Intake is a gate.

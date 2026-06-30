---
name: check-deps
description: Supply-chain gate — detect hallucinated/slopsquatted packages, mutable version specs, and missing lockfile coverage in a unit's dependency manifest. Wraps checks/scripts/pin-check.mjs.
wraps:
  - checks/scripts/pin-check.mjs
owner: security-compliance
---

# Skill: check-deps

> The security-compliance agent invokes this on every change that touches a
> dependency manifest. It is the harness's defense against the #1 agentic
> supply-chain risk: an LLM confidently adding a package that does not exist
> (hallucination) or that typosquats a real one (slopsquatting), or pinning to a
> mutable range that drifts.

## When to invoke
Whenever a unit's change adds, removes, or re-pins a dependency — i.e. the diff
touches `pyproject.toml` / `requirements*.txt` / `*.lock` (Python) or
`package.json` / `package-lock.json` (Node).

## Inputs
- The dependency manifest path for the unit's ecosystem.
- `--ecosystem node|python` (or let the check auto-detect from the manifest filename).

## Procedure
1. **Run pin-check on the real manifest:**
   ```bash
   # Node
   node <HARNESS_ROOT>/checks/scripts/pin-check.mjs --package <repo>/package.json
   # Python
   node <HARNESS_ROOT>/checks/scripts/pin-check.mjs --ecosystem python --manifest <repo>/pyproject.toml
   ```
2. **Read the signals.** The check flags: unknown/typosquatted package names,
   mutable/unpinned specs (e.g. `^1.2`, `>=1.0`, `*`, or `latest`), and deps not
   covered by a lockfile.
3. **Classify each finding** (this is the crux of the loop):
   - a real risk in the unit's code → **product-defect**: send back to the dev agent.
   - the check mis-firing on a valid spec for this ecosystem → **harness-defect**:
     generalize the gate (see `harness-bridge`), add a fixture, re-run S1–S6.
4. **Report** with the enforcement label (🟦 custom required job). RED = the unit
   does not pass the security gate.

## Honesty rules (hard)
- Never add or approve an **unpinned or unverified** dependency.
- Never silence a slopsquat/typosquat signal to unblock a merge.
- A manifest the check could not parse is **not** a pass — fix the input or the gate.

## Polyglot
pin-check is ecosystem-aware: `--ecosystem node` grades `package.json` (npm
allowlist + lockfile); `--ecosystem python` grades `pyproject.toml` / pinned
`requirements` / lockfiles with Python pinned-spec semantics + a PyPI typosquat
list. The skill picks the ecosystem; the **check owns the language logic**.

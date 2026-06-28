# Harness Backlog

Deferred-but-specced harness work. A backlog item graduates into a Loop only when pulled in
explicitly (human gate). This is the **discussion home** the human asked for ("make this a backlog
point to discuss"). Loop memory of what shipped lives in [`HARNESS_CHANGELOG.md`](./HARNESS_CHANGELOG.md);
the test/improve protocol is [`HARNESS_TESTING.md`](./HARNESS_TESTING.md) §6.

> Status legend: 🅿️ parked (specced, not started) · 🔬 prototyping · ✅ graduated to a Loop.

---

## B1 — Azure SRE agent + production observability 🅿️

**Why:** Loop-3 closed the *deploy-time* loop (does the pipeline conclude green?). It did **not** add
any *run-time* production signal. Today there is **zero** runtime observability — no logs/exceptions/
traces/metrics/cost in the sample app, `deploy.yml`, or `provision.ps1` (gap **G4**). "How do we
follow exceptions in production?" → currently we don't. An **Azure SRE agent** would watch production,
triage exceptions, and propose remediation — but it needs the observability substrate first.

**Specced design (so the discussion is concrete):**

1. **Observability substrate (prerequisite):**
   - Add an **Application Insights** resource in `provision.ps1` (Log Analytics already exists).
   - **Connection-string policy (rubber-duck call-out):** the App Insights *connection string /
     instrumentation key is NOT an auth secret* — it is an endpoint identifier. Inject it as an ACA
     env var / repo **Variable** (`vars.APPLICATIONINSIGHTS_CONNECTION_STRING`), **not** as a repo
     Secret, and **never hardcode** it. This keeps the secretless posture intact.
   - **App instrumentation decision:** either (a) Azure Monitor OpenTelemetry Distro in the sample app
     (`@azure/monitor-opentelemetry`) for real traces/exceptions, **or** (b) scope v1 to ACA console
     logs → Log Analytics only. Pick one explicitly; do not claim traces while shipping only console logs.
   - **Objective oracle (anti-theater):** a **KQL query filtered by `HARNESS_RUN_ID`** that proves a
     known request/exception arrived (e.g. `traces | where customDimensions.HARNESS_RUN_ID == "<id>"`).
     Without a passing oracle, "observability" is unverified.

2. **`run.mjs` cost/trace line:** emit a per-run trace id + token/cost summary so the harness itself is
   observable (SME move 3, deferred half).

3. **Azure SRE agent persona** (`harness/agents/sre.agent.md`): mission = watch prod telemetry → detect
   an exception/regression → open an issue with a triage + proposed remediation → (optionally) dispatch a
   `@copilot` fix unit through the existing dispatcher. Tools: `read, github, azure-monitor`.

4. **S6 production-incident scenario** (offline-first, rubber-duck **SHOULD-FIX #5**): ship **fixture
   telemetry payloads** + a **deterministic incident classifier** so the validator proves the SRE agent's
   logic with NO live App Insights dependency in T1. Live wiring is a separate Wave.

**Open questions for discussion:** do we need a *separate* Azure SRE Agent product, or is a persona +
Azure Monitor MCP enough? Per-app vs platform-wide SRE? How does SRE-opened remediation re-enter the
dispatcher without an infinite loop?

---

## B2 — Karpathy-style decision wiki inside an agent-managed repo 🅿️

**Why (the human's "don't forget this" idea):** the memory wiki (RAW/WIKI/SCHEMA 3-layer) could be
instantiated **inside** a harness-managed repo as the project's compiled **decision-log / changelog /
ADR system** — a backlinked, compiled history of *what was done, which decisions were taken, and why*,
maintained by the harness itself (e.g. an `ingest` step at end-of-loop).

**Relationship to what exists:** `HARNESS_CHANGELOG.md` is an **append-only flat log** (Karpathy Layer
1, RAW). The decision-wiki would be the **compiled, backlinked layer above it** (Layer 2, WIKI) — so a
human (or the next agent) can navigate "why is the deploy gate run-conclusion-aware?" → the L3 lesson →
the SME verdict → the book. Draft pattern: `~/projects/memory/wiki/patterns/agent-repo-decision-wiki.md`.

**Open questions:** per-repo wiki vs a section of the central memory wiki? Who writes it (a harness
`ingest` skill run at loop close)? How to avoid duplicating `HARNESS_CHANGELOG.md`? Prototype target: L4.

---

## B3 — Promote LM-judge from advisory → required 🅿️

Only if it ever earns determinism (pinned model + stable rubric + a reproducibility harness that proves
the same input ⇒ same verdict within tolerance). Until then it stays **advisory default-on** (Loop-3 M4):
it records findings, it never blocks the green invariant. See `CONTRACT.md` §11 (kept advisory by design).

---

## B4 — Full crutch-vs-durable taxonomy over ALL gates 🅿️

Loop-3 (M5) annotated only the **new** run-status gate (`CONTRACT.md` §11). Extend the
"does this survive a 2× smarter model?" pass to every gate (plan-lint, path-scope, trajectory,
eval-rubric, pin-check, doc-coupling, smoke, dispatch) and record the verdict + rationale per gate.
This is both a design-hygiene artifact and a demo talk-track.

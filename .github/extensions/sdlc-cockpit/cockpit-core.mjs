// Agentic SDLC Cockpit — core (no SDK import, so it is unit-testable in isolation).
// Owns: the demo model (stages/agents/story/units), per-instance state, a loopback
// HTTP server that serves the dashboard, a LIVE runner that shells out to the real
// `_internal/harness-selftest/validate/run.mjs --json`, and a REPLAY snapshot (the project's pre-baked
// fallback). One Cockpit instance per open canvas.

import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve, basename, delimiter } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const WEBUI = join(HERE, "webui.html");

function findRepoRoot(start) {
  let dir = start;
  for (let i = 0; i < 8; i += 1) {
    if (existsSync(join(dir, "_internal", "harness-selftest", "validate", "run.mjs"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return start;
}
const ROOT = findRepoRoot(HERE);
const VALIDATOR = join(ROOT, "_internal", "harness-selftest", "validate", "run.mjs");

// Inside the CLI extension host, process.execPath is the `copilot` binary, NOT
// node — so we must resolve a real node executable to run the validator script.
function findNode() {
  const b = basename(process.execPath).toLowerCase();
  if (b === "node" || b === "node.exe") return { cmd: process.execPath, shell: false };
  const exe = process.platform === "win32" ? "node.exe" : "node";
  for (const dir of (process.env.PATH || "").split(delimiter)) {
    if (!dir) continue;
    const p = join(dir, exe);
    if (existsSync(p)) return { cmd: p, shell: false };
  }
  return { cmd: "node", shell: true }; // last resort: let the shell resolve it
}
const NODE = findNode();

// ── Demo model (single source of truth, served to the page via /api/meta) ──────────
export const ENFORCE = {
  native: { emoji: "🟩", label: "native", cls: "native" },
  "ci-job": { emoji: "🟦", label: "CI job", cls: "cijob" },
  "local-assertion": { emoji: "🟦", label: "local", cls: "local" },
  advisory: { emoji: "🟨", label: "advisory", cls: "advisory" },
  external: { emoji: "⛔", label: "external", cls: "external" },
};

export const AGENTS = {
  planning: { stage: "plan", act: 1, label: "Planner", gate: "plan-lint · DAG", blurb: "Decomposes the intent into a DAG; a dependent unit must be ordered, not parallel." },
  "rubber-duck": { stage: "plan", act: 2, label: "Rubber-Duck", gate: "plan-lint · stress", blurb: "Devil's-advocate pass catches hidden shared-state deps before any code is written." },
  orchestrator: { stage: "plan", act: 4, label: "Dispatcher", gate: "dispatch · fan-out", blurb: "Fans out only an approved plan as one wave; refuses to dispatch an unapproved plan." },
  "dev-fleet": { stage: "implement", act: 5, label: "Dev fleet ×3", gate: "path-scope + trajectory", blurb: "Three lane-scoped PRs; straying out of lane or shipping no test is caught." },
  "quality-test": { stage: "test", act: 6, label: "Quality evals", gate: "eval-rubric", blurb: "Behavioural rubric: 429 at the threshold plus a numeric Retry-After header." },
  "security-compliance": { stage: "review", act: 7, label: "Security", gate: "pin-check", blurb: "Screens deps for typosquats / unpinned / mutable specs / missing lockfile." },
  "code-review": { stage: "review", act: 8, label: "Code review", gate: "doc-coupling", blurb: "Flags arch changes shipped without docs (advisory; CODEOWNERS blocks in T2)." },
  deployment: { stage: "deploy", act: 11, label: "Deploy", gate: "smoke + rollback", blurb: "Smoke → go/no-go; a broken /healthz triggers rollback + no-go." },
};

export const STAGES = [
  { id: "intake", n: 1, name: "Requirement intake", kind: "input", agents: [], human: [] },
  { id: "plan", n: 2, name: "Plan & design", agents: ["planning", "rubber-duck", "orchestrator"], human: [{ label: "plan-approved label", enf: "external", note: "human gate (native in T2)" }] },
  { id: "implement", n: 3, name: "Implement", agents: ["dev-fleet"], human: [] },
  { id: "test", n: 4, name: "Test", agents: ["quality-test"], human: [] },
  { id: "review", n: 5, name: "Review", agents: ["security-compliance", "code-review"], human: [] },
  { id: "pr", n: 6, name: "Pull request", kind: "native", agents: [], human: [{ label: "CODEOWNERS review", enf: "native", note: "T2" }, { label: "merge queue", enf: "native", note: "T2" }] },
  { id: "deploy", n: 7, name: "Deploy & docs", agents: ["deployment"], human: [{ label: "Environment approval", enf: "native", note: "human gate (native in T2)" }] },
];

export const STORY = "Add rate limiting to the URL-shortener API so a single client can't exhaust the service.";

export const UNITS = [
  { id: "U1", title: "limiter middleware", parallelSafe: true, dependsOn: [] },
  { id: "U2", title: "config surface (RATE_LIMIT_MAX / WINDOW_MS)", parallelSafe: true, dependsOn: [] },
  { id: "U3", title: "docs — rate-limit section", parallelSafe: true, dependsOn: [] },
  { id: "U4", title: "integration test (429 + Retry-After)", parallelSafe: false, dependsOn: ["U1", "U2"] },
];

// Pre-baked fallback — the project's known-good matrix (19/19, 10 negatives caught).
// Labelled REPLAY in the UI so it is never mistaken for a live run.
export const GOLDEN = [
  { agent: "planning", case: "positive-dependent-unit-ordered", polarity: "positive", enforcement: "local-assertion", driver: "plan-lint", expected: "pass", actual: "pass", signals: [], ok: true },
  { agent: "planning", case: "negative-ordered-unit-marked-parallel", polarity: "negative", enforcement: "local-assertion", driver: "plan-lint", expected: "blocked", actual: "blocked", signals: ["ordered-unit-marked-parallel"], ok: true },
  { agent: "rubber-duck", case: "positive-corrected-plan", polarity: "positive", enforcement: "local-assertion", driver: "plan-lint", expected: "pass", actual: "pass", signals: [], ok: true },
  { agent: "rubber-duck", case: "negative-hidden-dependency-and-unsafe-parallelization", polarity: "negative", enforcement: "local-assertion", driver: "plan-lint", expected: "blocked", actual: "blocked", signals: ["parallel-units-share-path", "integration-marked-parallel"], ok: true },
  { agent: "orchestrator", case: "positive-approved-fans-out", polarity: "positive", enforcement: "local-assertion", driver: "dispatch", expected: "pass", actual: "pass", signals: ["dispatched"], ok: true },
  { agent: "orchestrator", case: "negative-unapproved-no-dispatch", polarity: "negative", enforcement: "local-assertion", driver: "dispatch", expected: "blocked", actual: "blocked", signals: ["refused-unapproved"], ok: true },
  { agent: "dev-fleet", case: "u1-positive-in-lane", polarity: "positive", enforcement: "ci-job", driver: "path-scope", expected: "pass", actual: "pass", signals: [], ok: true },
  { agent: "dev-fleet", case: "u1-negative-strays-into-another-unit", polarity: "negative", enforcement: "ci-job", driver: "path-scope", expected: "blocked", actual: "blocked", signals: ["path-violation"], ok: true },
  { agent: "dev-fleet", case: "u1-trajectory-positive-test-added", polarity: "positive", enforcement: "ci-job", driver: "trajectory", expected: "pass", actual: "pass", signals: [], ok: true },
  { agent: "dev-fleet", case: "u1-trajectory-negative-no-test", polarity: "negative", enforcement: "ci-job", driver: "trajectory", expected: "blocked", actual: "blocked", signals: ["missing-required-test"], ok: true },
  { agent: "quality-test", case: "positive-good-limiter", polarity: "positive", enforcement: "ci-job", driver: "eval-rubric", expected: "pass", actual: "pass", signals: [], ok: true },
  { agent: "quality-test", case: "negative-no-429", polarity: "negative", enforcement: "ci-job", driver: "eval-rubric", expected: "blocked", actual: "blocked", signals: ["no-429", "missing-retry-after"], ok: true },
  { agent: "quality-test", case: "negative-missing-retry-after", polarity: "negative", enforcement: "ci-job", driver: "eval-rubric", expected: "blocked", actual: "blocked", signals: ["missing-retry-after"], ok: true },
  { agent: "security-compliance", case: "positive-pinned-real-app", polarity: "positive", enforcement: "ci-job", driver: "pin-check", expected: "pass", actual: "pass", signals: [], ok: true },
  { agent: "security-compliance", case: "negative-slopsquat-and-mutable", polarity: "negative", enforcement: "ci-job", driver: "pin-check", expected: "blocked", actual: "blocked", signals: ["no-lockfile", "unpinned", "slopsquat", "mutable"], ok: true },
  { agent: "code-review", case: "positive-docs-updated", polarity: "positive", enforcement: "advisory", driver: "doc-coupling", expected: "pass", actual: "pass", signals: [], ok: true },
  { agent: "code-review", case: "negative-arch-change-no-docs", polarity: "negative", enforcement: "advisory", driver: "doc-coupling", expected: "blocked", actual: "blocked", signals: ["missing-doc-update"], ok: true },
  { agent: "deployment", case: "positive-smoke-go", polarity: "positive", enforcement: "local-assertion", driver: "smoke", expected: "pass", actual: "pass", signals: [], ok: true },
  { agent: "deployment", case: "negative-smoke-fail-rollback", polarity: "negative", enforcement: "local-assertion", driver: "smoke", expected: "blocked", actual: "blocked", signals: ["rollback", "no-go"], ok: true },
];

export const META = { ENFORCE, AGENTS, STAGES, STORY, UNITS, root: ROOT, validatorPresent: existsSync(VALIDATOR) };

// ── tolerant JSON parse (in case a non-JSON note leaks onto stdout) ────────────────
function tolerantParse(text) {
  try { return JSON.parse(text); } catch { /* fall through */ }
  const a = text.indexOf("{");
  const b = text.lastIndexOf("}");
  if (a >= 0 && b > a) { try { return JSON.parse(text.slice(a, b + 1)); } catch { /* noop */ } }
  return null;
}

function runValidator(agent) {
  return new Promise((res) => {
    if (!existsSync(VALIDATOR)) { res({ ok: false, error: `validator not found at ${VALIDATOR}` }); return; }
    const args = [VALIDATOR, "--json"];
    if (agent) args.push("--filter", agent);
    let out = "", err = "";
    let child;
    try { child = spawn(NODE.cmd, args, { cwd: ROOT, shell: NODE.shell }); }
    catch (e) { res({ ok: false, error: e.message }); return; }
    child.stdout.on("data", (d) => { out += d; });
    child.stderr.on("data", (d) => { err += d; });
    child.on("error", (e) => res({ ok: false, error: e.message }));
    child.on("close", (code) => {
      const json = tolerantParse(out);
      if (json && Array.isArray(json.results)) res({ ok: true, json });
      else res({ ok: false, error: (err.trim() || out.trim() || `validator exited ${code}`).slice(0, 600) });
    });
  });
}

const keyOf = (r) => `${r.agent}/${r.case}`;
const FLEET_STAGES = new Set(["intake", "plan", "implement", "test", "review", "pr", "deploy"]);
const FLEET_STATUSES = new Set(["pending", "running", "done", "blocked"]);
const FLEET_GATES = new Set(["pending", "pass", "caught", "na"]);

function requireString(v, path) {
  if (typeof v !== "string") throw new Error(`cockpit_fleet.${path} must be a string`);
  return v;
}

function requireEnum(v, allowed, path) {
  const s = requireString(v, path);
  if (!allowed.has(s)) throw new Error(`cockpit_fleet.${path} has unsupported value '${s}'`);
  return s;
}

function normalizeFleet(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("cockpit_fleet input must be an object");
  if (!Number.isFinite(input.iteration)) throw new Error("cockpit_fleet.iteration must be a number");
  if (!Array.isArray(input.units)) throw new Error("cockpit_fleet.units must be an array");
  const fleet = {
    goal: requireString(input.goal, "goal"),
    iteration: input.iteration,
    units: input.units.map((u, i) => {
      if (!u || typeof u !== "object" || Array.isArray(u)) throw new Error(`cockpit_fleet.units[${i}] must be an object`);
      return {
        id: requireString(u.id, `units[${i}].id`),
        agent: requireString(u.agent, `units[${i}].agent`),
        title: requireString(u.title, `units[${i}].title`),
        branch: requireString(u.branch, `units[${i}].branch`),
        stage: requireEnum(u.stage, FLEET_STAGES, `units[${i}].stage`),
        status: requireEnum(u.status, FLEET_STATUSES, `units[${i}].status`),
        gate: requireEnum(u.gate, FLEET_GATES, `units[${i}].gate`),
      };
    }),
  };
  if (input.loop !== undefined) {
    if (!input.loop || typeof input.loop !== "object" || Array.isArray(input.loop)) throw new Error("cockpit_fleet.loop must be an object");
    fleet.loop = {};
    if (input.loop.lastVerdict !== undefined) fleet.loop.lastVerdict = requireString(input.loop.lastVerdict, "loop.lastVerdict");
    if (input.loop.action !== undefined) fleet.loop.action = requireString(input.loop.action, "loop.action");
  }
  return fleet;
}

export function createCockpit(instanceId) {
  const byKey = new Map();
  const runningAgents = new Set();
  let runningAll = false;
  let mode = "idle";       // idle | live | replay
  let lastRunAt = null;
  let error = null;
  let focus = null;
  let fleet = null;

  function summarize(values) {
    const total = values.length;
    const passed = values.filter((r) => r.ok).length;
    const negatives = values.filter((r) => r.polarity === "negative");
    const negCaught = negatives.filter((r) => r.ok).length;
    return { total, passed, failed: total - passed, negatives: negatives.length, negCaught };
  }

  function publicState() {
    const results = [...byKey.values()];
    const running = runningAll || runningAgents.size > 0;
    let status = "idle";
    if (running) status = "running";
    else if (results.length === 0) status = "idle";
    else status = summarize(results).failed > 0 ? "red" : "green";
    return {
      instanceId, mode, status,
      running: { all: runningAll, agents: [...runningAgents] },
      results, summary: summarize(results),
      lastRunAt, error, focus,
      fleet,
      meta: { validatorPresent: existsSync(VALIDATOR), root: ROOT },
    };
  }

  function applyJson(json, agent) {
    if (!agent) byKey.clear();
    for (const r of json.results) byKey.set(keyOf(r), r);
  }

  async function run(agent) {
    if (agent) { if (runningAgents.has(agent)) return; runningAgents.add(agent); }
    else { if (runningAll) return; runningAll = true; byKey.clear(); }
    error = null; mode = "live";
    const r = await runValidator(agent);
    if (r.ok) { applyJson(r.json, agent); lastRunAt = new Date().toISOString(); }
    else { error = r.error; }
    if (agent) runningAgents.delete(agent); else runningAll = false;
    return publicState();
  }

  function replay() {
    byKey.clear();
    for (const r of GOLDEN) byKey.set(keyOf(r), r);
    mode = "replay"; error = null; lastRunAt = new Date().toISOString();
    return publicState();
  }

  function reset() {
    byKey.clear(); runningAgents.clear(); runningAll = false;
    mode = "idle"; error = null; lastRunAt = null; focus = null; fleet = null;
    return publicState();
  }

  function setFocus(stage) { focus = stage || null; return publicState(); }

  function setFleet(input) {
    fleet = normalizeFleet(input);
    return publicState();
  }

  // ── HTTP server (loopback, ephemeral port) ──────────────────────────────────────
  function handle(req, res) {
    const url = new URL(req.url, "http://127.0.0.1");
    const send = (code, body, type = "application/json") => {
      res.statusCode = code;
      res.setHeader("Content-Type", `${type}; charset=utf-8`);
      res.setHeader("Cache-Control", "no-store");
      res.end(typeof body === "string" ? body : JSON.stringify(body));
    };
    if (req.method === "GET" && url.pathname === "/") {
      let html = "";
      try { html = readFileSync(WEBUI, "utf8"); } catch (e) { return send(500, `cannot read webui.html: ${e.message}`, "text/plain"); }
      return send(200, html, "text/html");
    }
    if (req.method === "GET" && url.pathname === "/api/meta") return send(200, { ENFORCE, AGENTS, STAGES, STORY, UNITS, instanceId });
    if (req.method === "GET" && url.pathname === "/api/state") return send(200, publicState());
    if (req.method === "POST" && url.pathname === "/api/run") {
      const agent = url.searchParams.get("agent") || undefined;
      run(agent); // fire-and-forget; page polls for the result
      return send(202, publicState());
    }
    if (req.method === "POST" && url.pathname === "/api/replay") return send(200, replay());
    if (req.method === "POST" && url.pathname === "/api/reset") return send(200, reset());
    if (req.method === "POST" && url.pathname === "/api/focus") return send(200, setFocus(url.searchParams.get("stage") || null));
    return send(404, { error: "not found" });
  }

  let server = null;
  let url = null;
  async function start() {
    if (url) return url;
    server = createServer(handle);
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    const a = server.address();
    url = `http://127.0.0.1:${typeof a === "object" && a ? a.port : 0}/`;
    return url;
  }
  async function stop() {
    if (server) { const s = server; server = null; url = null; await new Promise((r) => s.close(() => r())); }
  }

  return {
    instanceId,
    start, stop,
    run, replay, reset, setFocus, setFleet,
    get url() { return url; },
    get state() { return publicState(); },
  };
}

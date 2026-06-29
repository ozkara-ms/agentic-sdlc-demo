// harness/checks/lib/dispatch.mjs
// D4 — the dependency-graph DISPATCHER (pure core, no side effects, no deps).
//
// HONESTY (see _internal/harness-selftest/CONTRACT.md §5): this is LAYERED ORCHESTRATION, not native GitHub enforcement.
// GitHub enforces only required status checks / required reviews / the label-conditioned workflow
// result. The "plan-approved gate" below is the orchestrator *choosing* not to fan out — it does NOT
// natively block pre-code. Never present `decideDispatch` as a platform primitive.
//
// The canonical plan shape (shared by the Planning agent's output, this dispatcher, and the D5
// fixtures):
//   {
//     intent: string,
//     planApproved: boolean,                 // mirrors the human `plan-approved` label
//     units: [
//       { id, title, paths: string[], parallelSafe: boolean, dependsOn: string[] }, ...
//     ]
//   }

/** @typedef {{ id:string, title?:string, paths?:string[], parallelSafe?:boolean, dependsOn?:string[] }} Unit */
/** @typedef {{ intent?:string, planApproved?:boolean, units:Unit[] }} Plan */
/** @typedef {{ landed?:string[] }} State */

/**
 * Decide which units to fan out right now, given an (optionally approved) plan and what has landed.
 * Pure: same inputs → same output. Throws only on a structurally invalid plan.
 * @param {Plan} plan
 * @param {State} [state]
 */
export function decideDispatch(plan, state = {}) {
  validatePlan(plan);
  const landed = new Set(state.landed ?? []);
  const units = plan.units;
  const byId = new Map(units.map((u) => [u.id, u]));

  // Hard-but-LAYERED gate: refuse to fan out an unapproved plan. This is orchestration, not a
  // native pre-code block (see header).
  if (plan.planApproved !== true) {
    return {
      approved: false,
      refusal: 'plan is not approved (missing human `plan-approved` label) — dispatcher refuses to fan out',
      dispatch: [],
      held: units.filter((u) => !landed.has(u.id)).map((u) => ({ id: u.id, reason: 'plan not approved' })),
      conflicts: [],
      enforcement: 'local-assertion', // 🟦 orchestration, NOT native GitHub enforcement
    };
  }

  const held = [];
  const ready = [];

  for (const u of units) {
    if (landed.has(u.id)) continue;
    const deps = u.dependsOn ?? [];
    const missing = deps.filter((d) => !landed.has(d));
    if (missing.length > 0) {
      held.push({ id: u.id, reason: `waits on predecessor(s): ${missing.join(', ')}` });
      continue;
    }
    ready.push(u);
  }

  // Among ready units, co-dispatch only those that are mutually parallel-safe AND share no owned path.
  // A ready unit marked parallelSafe:false is "ordered": once its predecessors landed it is dispatched
  // ALONE (it must not run concurrently with others). The dispatcher also defensively catches a
  // planning error where two parallel-safe units overlap on paths.
  const dispatch = [];
  const conflicts = [];

  const orderedReady = ready.filter((u) => u.parallelSafe !== true);
  const parallelReady = ready.filter((u) => u.parallelSafe === true);

  if (parallelReady.length > 0) {
    const claimed = new Map(); // path -> unit id
    for (const u of parallelReady) {
      const overlap = (u.paths ?? []).filter((p) => claimed.has(p));
      if (overlap.length > 0) {
        const others = [...new Set(overlap.map((p) => claimed.get(p)))];
        conflicts.push({ ids: [others[0], u.id], paths: overlap });
        held.push({ id: u.id, reason: `path overlap with ${others.join(', ')} — plan needs re-validation` });
        continue;
      }
      for (const p of u.paths ?? []) claimed.set(p, u.id);
      dispatch.push(u.id);
    }
    // Ordered-but-ready units wait while a parallel wave is in flight (run them in a later, solo wave).
    for (const u of orderedReady) {
      held.push({ id: u.id, reason: 'ordered unit deferred until the in-flight parallel wave lands' });
    }
  } else {
    // No parallel work ready → dispatch ordered-ready units one at a time (deterministic: first only).
    if (orderedReady.length > 0) {
      dispatch.push(orderedReady[0].id);
      for (const u of orderedReady.slice(1)) {
        held.push({ id: u.id, reason: 'ordered unit — dispatched in a later solo wave' });
      }
    }
  }

  return {
    approved: true,
    refusal: null,
    dispatch,
    held,
    conflicts,
    enforcement: 'local-assertion', // 🟦 the wave decision is orchestration logic
    _meta: { ready: ready.map((u) => u.id), landed: [...landed], total: units.length, byId: [...byId.keys()] },
  };
}

/** Minimal structural validation. Throws on malformed plans so failures are loud, not silent. */
export function validatePlan(plan) {
  if (!plan || typeof plan !== 'object') throw new TypeError('plan must be an object');
  if (!Array.isArray(plan.units) || plan.units.length === 0) throw new TypeError('plan.units must be a non-empty array');
  const ids = new Set();
  for (const u of plan.units) {
    if (!u || typeof u.id !== 'string') throw new TypeError('every unit needs a string id');
    if (ids.has(u.id)) throw new TypeError(`duplicate unit id: ${u.id}`);
    ids.add(u.id);
  }
  for (const u of plan.units) {
    for (const d of u.dependsOn ?? []) {
      if (!ids.has(d)) throw new TypeError(`unit ${u.id} depends on unknown unit ${d}`);
      if (d === u.id) throw new TypeError(`unit ${u.id} depends on itself`);
    }
  }
  detectCycle(plan.units);
  return true;
}

function detectCycle(units) {
  const byId = new Map(units.map((u) => [u.id, u]));
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map(units.map((u) => [u.id, WHITE]));
  const visit = (id, stack) => {
    color.set(id, GRAY);
    for (const d of byId.get(id).dependsOn ?? []) {
      const c = color.get(d);
      if (c === GRAY) throw new TypeError(`dependency cycle: ${[...stack, id, d].join(' -> ')}`);
      if (c === WHITE) visit(d, [...stack, id]);
    }
    color.set(id, BLACK);
  };
  for (const u of units) if (color.get(u.id) === WHITE) visit(u.id, []);
}

/** Human-readable rendering of a decision for the CLI / presenter. */
export function formatDecision(decision) {
  const lines = [];
  lines.push(`approved: ${decision.approved}  [enforcement: ${decision.enforcement} — 🟦 layered orchestration, NOT native GitHub enforcement]`);
  if (decision.refusal) lines.push(`REFUSAL: ${decision.refusal}`);
  lines.push(`dispatch (fan out now): ${decision.dispatch.length ? decision.dispatch.join(', ') : '(none)'}`);
  if (decision.held.length) {
    lines.push('held:');
    for (const h of decision.held) lines.push(`  - ${h.id}: ${h.reason}`);
  }
  if (decision.conflicts.length) {
    lines.push('CONFLICTS (plan needs re-validation):');
    for (const c of decision.conflicts) lines.push(`  - ${c.ids.join(' ↔ ')} overlap on ${c.paths.join(', ')}`);
  }
  return lines.join('\n');
}

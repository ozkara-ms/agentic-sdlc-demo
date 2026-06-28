// demos/ci/lib/run-status.mjs
// M1 (Loop 3) — PURE run-status classifier. NO I/O, NO child_process, NO network.
//
// This is the keystone of the closed-loop deploy/run-status gate (G1–G3). It answers one
// question deterministically: "given the GitHub Actions runs visible for a piece of work and
// the IDENTITY of the run I care about, is the workflow conclusion a GO or a NO-GO?"
//
// HONESTY: this is 🟦 layered harness logic, not a native GitHub primitive. GitHub owns the
// run; we only READ + classify its conclusion. The side-effecting reader lives in
// gh-run-reader.mjs (the adapter) so this module stays pure and offline-fixtureable — a "red
// pipeline" is a canned JSON object here, never a live one-shot (see rubber-duck BLOCKING #1/#5).
//
// NEVER-FAKE-GREEN stance: only an affirmative `success` (or GitHub's explicit non-failing
// `neutral`) is a GO. Everything else — failure, timed_out, cancelled, action_required,
// startup_failure, skipped, or a still-running run — is a NO-GO with a distinct signal.

/** All terminal conclusions GitHub Actions can report (plus null = not yet concluded). */
export const CONCLUSIONS = [
  'success', 'failure', 'cancelled', 'timed_out',
  'skipped', 'neutral', 'action_required', 'startup_failure', null,
];

/** GitHub run `status` values. Only 'completed' carries a meaningful conclusion. */
export const STATUSES = ['queued', 'in_progress', 'completed', 'waiting', 'requested', 'pending'];

/**
 * Classify a single run's (status, conclusion) into a go/no-go decision.
 * @param {string|null|undefined} conclusion
 * @param {string|null|undefined} status
 * @returns {{ decision:'go'|'no-go'|'pending', signals:string[], terminal:boolean, reason:string }}
 */
export function classifyConclusion(conclusion, status) {
  // A run that has not COMPLETED has no trustworthy conclusion yet → pending (the watch loop
  // keeps polling; a gate evaluated right now cannot pass on an unfinished run).
  if (status != null && status !== 'completed') {
    return { decision: 'pending', signals: ['run-incomplete'], terminal: false, reason: `run status is "${status}" (not completed)` };
  }
  switch (conclusion) {
    case 'success':
      return { decision: 'go', signals: [], terminal: true, reason: 'run concluded success' };
    case 'neutral':
      // GitHub semantics: neutral is explicitly non-failing. Allowed as GO but flagged.
      return { decision: 'go', signals: ['run-neutral'], terminal: true, reason: 'run concluded neutral (non-failing)' };
    case 'failure':
      return { decision: 'no-go', signals: ['run-failed'], terminal: true, reason: 'run concluded failure' };
    case 'timed_out':
      return { decision: 'no-go', signals: ['run-timed-out'], terminal: true, reason: 'run concluded timed_out' };
    case 'cancelled':
      return { decision: 'no-go', signals: ['run-cancelled'], terminal: true, reason: 'run concluded cancelled' };
    case 'action_required':
      return { decision: 'no-go', signals: ['run-action-required'], terminal: true, reason: 'run concluded action_required' };
    case 'startup_failure':
      return { decision: 'no-go', signals: ['run-startup-failure'], terminal: true, reason: 'run concluded startup_failure' };
    case 'skipped':
      // A skipped deploy run is NOT a successful deploy → block (never-fake-green).
      return { decision: 'no-go', signals: ['run-skipped'], terminal: true, reason: 'run concluded skipped (nothing deployed)' };
    default:
      // completed but unknown/empty conclusion — treat conservatively as no-go.
      return { decision: 'no-go', signals: ['run-unknown-conclusion'], terminal: true, reason: `run completed with unrecognized conclusion "${conclusion}"` };
  }
}

/**
 * Does a normalized run match the identity we care about? Every identity field that is PROVIDED
 * must equal the run's. A provided `headSha` that does not match excludes the run — this is what
 * makes "a green run for the WRONG sha" correctly NOT satisfy the gate.
 * @param {object} run normalized run
 * @param {object} identity { repo?, headSha?, workflowName?, workflowPath?, event?, runId?, runAttempt? }
 */
export function matchesIdentity(run, identity = {}) {
  const eq = (a, b) => String(a) === String(b);
  if (identity.headSha != null && !(run.headSha != null && eq(run.headSha, identity.headSha))) return false;
  if (identity.runId != null && !(run.runId != null && eq(run.runId, identity.runId))) return false;
  if (identity.runAttempt != null && !(run.runAttempt != null && eq(run.runAttempt, identity.runAttempt))) return false;
  if (identity.event != null && !(run.event != null && eq(run.event, identity.event))) return false;
  if (identity.workflowName != null && !(run.workflowName != null && eq(run.workflowName, identity.workflowName))) return false;
  if (identity.workflowPath != null && !(run.workflowPath != null && eq(run.workflowPath, identity.workflowPath))) return false;
  if (identity.repo != null && run.repo != null && !eq(run.repo, identity.repo)) return false;
  return true;
}

/** Newest-first comparator: highest runAttempt, then newest createdAt, then highest runId. */
function cmpRunsDesc(a, b) {
  const att = Number(b.runAttempt ?? 0) - Number(a.runAttempt ?? 0);
  if (att !== 0) return att;
  const ta = Date.parse(a.createdAt ?? '') || 0;
  const tb = Date.parse(b.createdAt ?? '') || 0;
  if (tb !== ta) return tb - ta;
  return Number(b.runId ?? 0) - Number(a.runId ?? 0);
}

/**
 * Select THE run that represents the current truth for an identity from a list: the newest
 * matching run (highest attempt, then newest). This is what makes "older green + newer red"
 * resolve to the RED run, and a rerun (attempt-1 fail → attempt-2 success) resolve to attempt 2.
 * @returns {{ run:object|null, signals:string[], reason:string }}
 */
export function selectRun(runs, identity = {}) {
  const list = Array.isArray(runs) ? runs : [];
  const matches = list.filter((r) => matchesIdentity(r, identity));
  if (matches.length === 0) {
    return { run: null, signals: ['no-matching-run'], reason: 'no run matches the requested identity' };
  }
  const sorted = matches.slice().sort(cmpRunsDesc);
  return { run: sorted[0], signals: [], reason: `selected newest of ${matches.length} matching run(s)` };
}

/**
 * End-to-end gate: over a set of runs + an identity, decide GO / NO-GO / PENDING.
 * `pass` is true ONLY for a GO. PENDING and NO-GO both yield pass=false (the gate cannot promote).
 * @returns {{ decision:'go'|'no-go'|'pending', pass:boolean, signals:string[], reason:string, run:object|null }}
 */
export function evaluateRunStatus(runs, identity = {}) {
  const sel = selectRun(runs, identity);
  if (!sel.run) {
    return { decision: 'no-go', pass: false, signals: sel.signals, reason: sel.reason, run: null };
  }
  const cls = classifyConclusion(sel.run.conclusion, sel.run.status);
  return {
    decision: cls.decision,
    pass: cls.decision === 'go',
    signals: cls.signals,
    reason: cls.reason,
    run: sel.run,
  };
}

/**
 * PURE retry-taxonomy (Loop-3 D-D): given an evaluation and whether we've exhausted the watch
 * window, decide the orchestrator's reaction. Retry ONLY transient conditions (still-queued past
 * the window, runner/infra cancellation, no run yet started). NEVER auto-retry a real failure
 * (failed tests/smoke/deploy/E2E, timed_out job, action_required) — report it instead.
 * @param {object} evaluation result of evaluateRunStatus
 * @param {{ timedOut?:boolean, attempt?:number, maxRetries?:number }} ctx
 * @returns {{ action:'proceed'|'wait'|'retry'|'report-failure', retryable:boolean, signals:string[], reason:string }}
 */
export function decideReaction(evaluation, ctx = {}) {
  const attempt = Number(ctx.attempt ?? 1);
  const maxRetries = Number(ctx.maxRetries ?? 1);
  const sig = new Set(evaluation.signals ?? []);

  if (evaluation.decision === 'go') {
    return { action: 'proceed', retryable: false, signals: [], reason: 'run concluded GO — proceed' };
  }

  // Transient: a run that has not finished. Keep waiting until the window closes, then it is a
  // queued-timeout (transient infra) → retry within budget.
  if (evaluation.decision === 'pending' || sig.has('no-matching-run') || sig.has('run-incomplete')) {
    if (!ctx.timedOut) return { action: 'wait', retryable: true, signals: ['watch-wait'], reason: 'run not concluded yet — keep watching' };
    return attempt <= maxRetries
      ? { action: 'retry', retryable: true, signals: ['queued-timeout'], reason: 'run never concluded within the window (transient) — retry' }
      : { action: 'report-failure', retryable: false, signals: ['queued-timeout', 'retries-exhausted'], reason: 'run never concluded and retries exhausted — report' };
  }

  // Runner/infra cancellation is transient → retry within budget.
  if (sig.has('run-cancelled')) {
    return attempt <= maxRetries
      ? { action: 'retry', retryable: true, signals: ['runner-cancelled'], reason: 'run cancelled (treat as infra/runner) — retry' }
      : { action: 'report-failure', retryable: false, signals: ['run-cancelled', 'retries-exhausted'], reason: 'run cancelled and retries exhausted — report' };
  }

  // Everything else is a REAL failure: failed tests/smoke/deploy/E2E, timed_out job,
  // action_required, skipped, startup_failure, unknown. NEVER auto-retry — report.
  return { action: 'report-failure', retryable: false, signals: [...sig], reason: `hard failure (${[...sig].join(', ') || 'no-go'}) — report, do not auto-retry` };
}

// demos/ci/lib/approval.mjs
// L4 — PURE decision core for TEST-MODE DELEGATED approval. NO I/O, NO gh, NO network.
//
// HONESTY (load-bearing — see CONTRACT.md §12): this does NOT remove or weaken the native gates.
// The `production` GitHub Environment reviewer + the bot-PR "approve and run" policy STILL exist.
// This core only decides whether the harness may perform the OWNER'S approval click PROGRAMMATICALLY
// for a TEST repo — and every approval is logged "no human reviewed this run at approval time".
// It is 🟨 test-mode delegated approval, NOT 🟩 human verification.
//
// SAFETY: "the loop dispatched it" is NOT a sufficient boundary on a PUBLIC repo. EVERY precondition
// below must hold or we REFUSE. Default is DRY-RUN; a live approval requires AUTO_APPROVE_TEST_MODE=1.

export const ALLOWED_REPO = 'ozkara-ms/agentic-sdlc-demo-live';
export const ALLOWED_REPOS = ['ozkara-ms/agentic-sdlc-demo-live', 'ozgurkarahan/agentic-sdlc-demo-live'];
export const ALLOWED_BRANCH_PREFIXES = ['copilot/', 'loop4/', 'proof/loop4'];
export const REQUIRED_LABEL = 'loop4-test';
// A PR touching any of these is REFUSED (it could change what the gate enforces) unless the path is
// the unit's single declared path. Approving a workflow/infra/auth change unattended is the nightmare.
export const SENSITIVE_PATHS = ['.github/workflows/', 'infra/', 'deploy/', 'provision', '.azure', 'auth', 'secret', 'OIDC', 'oidc'];

/**
 * Decide whether to (delegated-)approve a gated run/deployment. PURE.
 * @param {object} ctx {
 *   repo, runId, headSha, prLabels[], changedFiles[], branch, environment,
 *   currentUserCanApprove, ledger:{[runId]:{expectedSha}}, approvalsSoFar, maxApprovals,
 *   nowMs, deadlineMs, killSwitch, testMode, declaredPaths[]
 * }
 * @returns {{ approve, dryRun, reason, signals[] }}
 */
export function decideApproval(ctx = {}) {
  const s = [];
  const refuse = (sig, reason) => ({ approve: false, dryRun: false, reason, signals: [sig] });

  if (ctx.killSwitch) return refuse('kill-switch', 'HARNESS_KILL set — refusing all approvals');
  if (!ALLOWED_REPOS.includes(ctx.repo)) return refuse('repo-not-allowed', `repo ${ctx.repo} not in allowlist`);
  if (!ctx.ledger || !ctx.ledger[ctx.runId]) return refuse('not-in-ledger', `run ${ctx.runId} not in the dispatch ledger`);
  if (ctx.ledger[ctx.runId].expectedSha && ctx.headSha !== ctx.ledger[ctx.runId].expectedSha) {
    return refuse('sha-mismatch', `head ${ctx.headSha} != ledger ${ctx.ledger[ctx.runId].expectedSha}`);
  }
  if (!(ctx.prLabels ?? []).includes(REQUIRED_LABEL)) return refuse('missing-label', `PR lacks required label "${REQUIRED_LABEL}"`);
  if (!ALLOWED_BRANCH_PREFIXES.some((p) => (ctx.branch ?? '').startsWith(p))) return refuse('branch-not-allowed', `branch ${ctx.branch} not allowlisted`);

  const declared = new Set(ctx.declaredPaths ?? []);
  const bad = (ctx.changedFiles ?? []).filter((f) => SENSITIVE_PATHS.some((p) => f.includes(p)) && !declared.has(f));
  if (bad.length) return refuse('sensitive-files-changed', `refusing: PR changes sensitive paths ${bad.join(', ')}`);

  if (ctx.environment != null && ctx.environment !== 'production' && ctx.environment !== 'staging') {
    return refuse('env-not-allowed', `environment ${ctx.environment} not allowlisted`);
  }
  if (ctx.environment === 'production' && ctx.currentUserCanApprove === false) {
    return refuse('cannot-approve', 'owner token cannot approve this environment');
  }
  if ((ctx.approvalsSoFar ?? 0) >= (ctx.maxApprovals ?? 3)) return refuse('over-budget', `approval budget ${ctx.maxApprovals} reached`);
  if (ctx.deadlineMs != null && ctx.nowMs != null && ctx.nowMs > ctx.deadlineMs) return refuse('deadline-expired', 'session deadline expired');

  // All preconditions pass. Live only under explicit test-mode env; else dry-run.
  if (!ctx.testMode) return { approve: false, dryRun: true, reason: 'DRY-RUN (AUTO_APPROVE_TEST_MODE not set) — would approve', signals: ['dry-run', 'would-approve'] };
  return { approve: true, dryRun: false, reason: 'TEST-MODE delegated approval — no human reviewed at approval time', signals: ['delegated-approve'] };
}

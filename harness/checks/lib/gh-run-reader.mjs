// harness/checks/lib/gh-run-reader.mjs
// M1 (Loop 3) — the SIDE-EFFECTING adapter for run-status. This is the ONLY place that shells
// out to `gh`. It normalizes GitHub's JSON into the schema the PURE classifier (run-status.mjs)
// understands. Keeping I/O here (and the classification in run-status.mjs) is what kills the
// M2→M1 circularity the rubber-duck flagged: the validator fixtures call the pure core with
// canned JSON and never touch `gh`; only live `--watch`/live checks use this adapter.

import { execFileSync } from 'node:child_process';

/** Default `gh` runner. Injectable so callers/tests can stub it. */
function defaultGh(args) {
  return execFileSync('gh', args, { encoding: 'utf8' });
}

/**
 * Normalize one `gh run list/view --json` record to the run-status.mjs schema.
 * GitHub field names vary between `run list` and `run view`; we map both.
 */
export function normalizeRun(raw, ctx = {}) {
  if (!raw || typeof raw !== 'object') return null;
  return {
    runId: raw.databaseId ?? raw.id ?? raw.runId ?? null,
    headSha: raw.headSha ?? raw.head_sha ?? null,
    status: raw.status ?? null,
    conclusion: raw.conclusion ?? null,
    event: raw.event ?? null,
    workflowName: raw.workflowName ?? raw.name ?? null,
    workflowPath: raw.path ?? raw.workflowPath ?? null,
    // `attempt` only appears in `gh run view`; `gh run list` omits it → default 1.
    runAttempt: raw.attempt ?? raw.runAttempt ?? raw.run_attempt ?? 1,
    createdAt: raw.createdAt ?? raw.created_at ?? null,
    headBranch: raw.headBranch ?? raw.head_branch ?? null,
    repo: ctx.repo ?? raw.repo ?? null,
  };
}

const LIST_FIELDS = 'databaseId,headSha,status,conclusion,event,workflowName,createdAt,headBranch';
const VIEW_FIELDS = 'databaseId,headSha,status,conclusion,event,workflowName,attempt,createdAt,headBranch';

/**
 * Read recent runs for a repo/workflow via `gh run list`, normalized + identity-tagged.
 * @param {{ repo:string, workflow?:string, branch?:string, event?:string, limit?:number, gh?:Function }} opts
 * @returns {Promise<object[]>}
 */
export async function readRuns(opts = {}) {
  const gh = opts.gh ?? defaultGh;
  if (!opts.repo) throw new Error('readRuns: --repo owner/name is required');
  const args = ['run', 'list', '--repo', opts.repo, '--json', LIST_FIELDS, '-L', String(opts.limit ?? 30)];
  if (opts.workflow) args.push('--workflow', opts.workflow);
  if (opts.branch) args.push('--branch', opts.branch);
  if (opts.event) args.push('--event', opts.event);
  const out = gh(args);
  const parsed = JSON.parse(out);
  return (Array.isArray(parsed) ? parsed : []).map((r) => normalizeRun(r, { repo: opts.repo })).filter(Boolean);
}

/**
 * Read a single run by id via `gh run view` (carries the real `attempt`). Useful to upgrade a
 * list record (attempt defaulted to 1) with the true attempt number.
 * @returns {Promise<object|null>}
 */
export async function readRun(opts = {}) {
  const gh = opts.gh ?? defaultGh;
  if (!opts.repo || opts.runId == null) throw new Error('readRun: --repo and runId are required');
  const out = gh(['run', 'view', String(opts.runId), '--repo', opts.repo, '--json', VIEW_FIELDS]);
  return normalizeRun(JSON.parse(out), { repo: opts.repo });
}

/**
 * Read PR check-runs via `gh pr checks` (for PR-validation jobs, distinct from the deploy run).
 * Returned shape is the raw check rows; callers decide how to interpret bucket/state.
 * @returns {Promise<object[]>}
 */
export async function readPrChecks(opts = {}) {
  const gh = opts.gh ?? defaultGh;
  if (!opts.repo || opts.pr == null) throw new Error('readPrChecks: --repo and pr are required');
  // `gh pr checks` exits non-zero when checks are failing/pending; capture either way.
  let out;
  try {
    out = gh(['pr', 'checks', String(opts.pr), '--repo', opts.repo, '--json', 'name,state,bucket,workflow,completedAt']);
  } catch (e) {
    out = e.stdout ?? '[]';
  }
  try { return JSON.parse(out); } catch { return []; }
}

#!/usr/bin/env node
// demos/ci/scripts/auto-approve.mjs
// L4 — TEST-MODE delegated-approval adapter. Wraps the PURE core (ci/lib/approval.mjs) with the
// gh-side I/O. Offline: --input <fixture> exercises the decision deterministically. Live: discovers
// pending production deployments and approves them ONLY if the pure core says so AND testMode is set.
//
// HONEST: keeps the native gate; logs every approval as "no human reviewed at approval time".
// Exit 0 = approve/dry-run-would-approve; 1 = refuse; 2 = error.
//
// Usage:
//   node auto-approve.mjs --input <fixture.json> [--json]
//   node auto-approve.mjs --repo o/n --run-id <id> --live [--json]   # needs AUTO_APPROVE_TEST_MODE=1

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { decideApproval } from '../lib/approval.mjs';

function parseArgs(argv) {
  const a = { json: false };
  for (let i = 2; i < argv.length; i++) {
    const x = argv[i];
    if (x === '--json') a.json = true; else if (x === '--input') a.input = argv[++i];
    else if (x === '--repo') a.repo = argv[++i]; else if (x === '--run-id') a.runId = argv[++i];
    else if (x === '--live') a.live = true;
    else if (x === '--approve-run') a.approveRun = argv[++i];
    else if (x === '--pr') a.pr = argv[++i];
    else if (x === '--sha') a.sha = argv[++i];
  }
  return a;
}

function ctxFromFixture(p) {
  const fx = JSON.parse(readFileSync(resolve(p), 'utf8'));
  const c = fx.input ?? fx;
  c.killSwitch = c.killSwitch ?? (process.env.HARNESS_KILL === '1');
  c.testMode = c.testMode ?? (process.env.AUTO_APPROVE_TEST_MODE === '1');
  c.nowMs = c.nowMs ?? Date.now();
  return c;
}

function main() {
  const a = parseArgs(process.argv);
  if (a.approveRun) { return liveApprove(a); }
  if (a.live) { return liveDiscover(a); }
  if (!a.input) { console.error('auto-approve: --input <fixture> required, or --live --repo o/n'); process.exitCode = 2; return; }
  const ctx = ctxFromFixture(a.input);
  const d = decideApproval(ctx);
  const report = { check: 'auto-approve', enforcement: 'env policy present (🟩) + TEST-MODE delegated owner approval (🟨)', repo: ctx.repo, runId: ctx.runId, environment: ctx.environment, decision: d.approve ? 'approve' : (d.dryRun ? 'dry-run' : 'refuse'), reason: d.reason, signals: d.signals, audit: d.approve ? 'auto-approved by harness using owner token; NO human reviewed this run at approval time' : null };
  if (a.json) process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  else console.log(`auto-approve: ${report.decision} — ${d.reason} [${d.signals.join(',')}]`);
  process.exitCode = (d.approve || d.dryRun) ? 0 : 1;
}

// Bounded LIVE discovery (dry-run by default). Lists action_required runs + pending production
// deployments so we can SEE what the gate is, without approving unless AUTO_APPROVE_TEST_MODE=1.
async function liveDiscover(a) {
  if (!a.repo) { console.error('auto-approve --live: --repo required'); process.exitCode = 2; return; }
  const { execFileSync } = await import('node:child_process');
  const gh = (args) => { try { return execFileSync('gh', args, { encoding: 'utf8' }); } catch (e) { return e.stdout ?? '[]'; } };
  const runs = JSON.parse(gh(['run', 'list', '--repo', a.repo, '--status', 'action_required', '-L', '10', '--json', 'databaseId,workflowName,headSha,event']));
  console.log(`live-discover: ${runs.length} action_required run(s) on ${a.repo}`);
  for (const r of runs.slice(0, 5)) {
    const pd = JSON.parse(gh(['api', `repos/${a.repo}/actions/runs/${r.databaseId}/pending_deployments`]) || '[]');
    const envs = pd.map((p) => `${p.environment?.name}(canApprove=${p.current_user_can_approve})`).join(',') || '(none)';
    console.log(`  run ${r.databaseId} ${r.workflowName} → pending envs: ${envs}`);
  }
  console.log(`mode: ${process.env.AUTO_APPROVE_TEST_MODE === '1' ? 'TEST-MODE (would approve in-scope)' : 'DRY-RUN (no approvals; AUTO_APPROVE_TEST_MODE unset)'}`);
  process.exitCode = 0;
}
// LIVE approve a specific run (TEST-MODE) — the real "take action on my behalf". Discovers run +
// PR metadata, builds ctx, lets the PURE core decide (all safety preconditions), and only POSTs the
// approval when AUTO_APPROVE_TEST_MODE=1. 403/404 → KNOWN-DEFECT (no infinite retry).
async function liveApprove(a) {
  if (!a.repo || !a.sha) { console.error('--approve-run needs --repo and --sha'); process.exitCode = 2; return; }
  const { execFileSync } = await import('node:child_process');
  const gh = (args) => { try { return execFileSync('gh', args, { encoding: 'utf8' }); } catch (e) { return { err: true, out: e.stdout ?? '', msg: e.message }; } };
  const labels = a.pr ? JSON.parse(gh(['pr', 'view', String(a.pr), '--repo', a.repo, '--json', 'labels']) || '{"labels":[]}').labels.map((l) => l.name) : [];
  const files = a.pr ? gh(['pr', 'diff', String(a.pr), '--repo', a.repo, '--name-only']).toString().split('\n').map((s) => s.trim()).filter(Boolean) : [];
  const ctx = { repo: a.repo, runId: a.approveRun, headSha: a.sha, prLabels: labels, changedFiles: files, branch: 'copilot/fix-rate-limiting-issue', ledger: { [a.approveRun]: { expectedSha: a.sha } }, maxApprovals: 3, approvalsSoFar: 0, killSwitch: process.env.HARNESS_KILL === '1', testMode: process.env.AUTO_APPROVE_TEST_MODE === '1', nowMs: Date.now() };
  const d = decideApproval(ctx);
  console.log(`approve-run ${a.approveRun}: ${d.approve ? 'APPROVE' : d.dryRun ? 'DRY-RUN' : 'REFUSE'} — ${d.reason} [${d.signals.join(',')}]`);
  if (d.approve) {
    const r = gh(['api', '-X', 'POST', `repos/${a.repo}/actions/runs/${a.approveRun}/approve`]);
    if (r.err) { console.log(`  KNOWN-DEFECT: approve endpoint failed — ${r.msg.split('\n')[0]}`); process.exitCode = 1; return; }
    console.log('  ✓ delegated-approved (owner token; NO human reviewed at approval time)');
  }
  process.exitCode = 0;
}
main();

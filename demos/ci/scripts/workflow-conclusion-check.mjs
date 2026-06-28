#!/usr/bin/env node
// demos/ci/scripts/workflow-conclusion-check.mjs
// M2 (Loop 3) — the Deployment gate's NEW run-conclusion oracle (G1 + G3).
//
// WHY: the harness previously judged a deploy ONLY by a live /healthz smoke probe. A GitHub
// Actions run could go RED (failed job, cancelled, never finished) while /healthz stayed green,
// and the loop would never notice (rubber-duck BLOCKING #1/#2). This check asserts the WORKFLOW
// CONCLUSION for an identity-bound run, as a POST-RUN ORACLE owned by the validator/orchestrator —
// it is NOT a final step inside deploy.yml (which can't see its own final conclusion).
//
// OFFLINE-FIRST: in T1 the validator passes a fixture whose `input` carries a canned `runs` array
// + `identity`. A "red pipeline" is therefore replayable JSON, never a live one-shot. Live mode
// (--repo/--workflow/--sha) uses the gh-run-reader adapter and is exercised in Wave 2.
//
// Usage:
//   node workflow-conclusion-check.mjs --input <fixture.json> [--json]      # validator / canned
//   node workflow-conclusion-check.mjs --runs <runs.json> --sha <sha> [--workflow N --event E] [--json]
//   node workflow-conclusion-check.mjs --repo o/n --workflow deploy.yml --sha <sha> [--event push --branch main --limit 30] [--json]   # live (Wave 2)
//
// Exit 0 only on a GO (success/neutral). NO-GO and PENDING exit 1; usage/IO errors exit 2.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { evaluateRunStatus } from '../lib/run-status.mjs';

function parseArgs(argv) {
  const args = { json: false };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--json') args.json = true;
    else if (a === '--input') args.input = argv[++i];
    else if (a === '--runs') args.runs = argv[++i];
    else if (a === '--repo') args.repo = argv[++i];
    else if (a === '--workflow') args.workflow = argv[++i];
    else if (a === '--sha') args.sha = argv[++i];
    else if (a === '--event') args.event = argv[++i];
    else if (a === '--branch') args.branch = argv[++i];
    else if (a === '--run-id') args.runId = argv[++i];
    else if (a === '--limit') args.limit = Number(argv[++i]);
  }
  return args;
}

function identityFrom(args, fixtureIdentity) {
  // Explicit flags win over a fixture's identity block.
  const id = { ...(fixtureIdentity ?? {}) };
  if (args.sha) id.headSha = args.sha;
  if (args.workflow) id.workflowName = id.workflowName ?? args.workflow;
  if (args.event) id.event = args.event;
  if (args.runId) id.runId = args.runId;
  if (args.repo) id.repo = args.repo;
  return id;
}

async function loadRuns(args) {
  // 1) validator fixture: { input: { runs, identity } }
  if (args.input) {
    const fx = JSON.parse(readFileSync(resolve(args.input), 'utf8'));
    const input = fx.input ?? fx;
    return { runs: input.runs ?? [], identity: input.identity ?? {} };
  }
  // 2) canned runs file
  if (args.runs) {
    const parsed = JSON.parse(readFileSync(resolve(args.runs), 'utf8'));
    return { runs: Array.isArray(parsed) ? parsed : (parsed.runs ?? []), identity: parsed.identity ?? {} };
  }
  // 3) live: read from gh via the adapter (Wave 2)
  if (args.repo) {
    const { readRuns } = await import('../lib/gh-run-reader.mjs');
    const runs = await readRuns({ repo: args.repo, workflow: args.workflow, branch: args.branch, event: args.event, limit: args.limit });
    return { runs, identity: {} };
  }
  throw new Error('one of --input <fixture>, --runs <file>, or --repo <owner/name> is required');
}

async function main() {
  const args = parseArgs(process.argv);
  let runs;
  let baseIdentity;
  try {
    ({ runs, identity: baseIdentity } = await loadRuns(args));
  } catch (e) {
    console.error(`workflow-conclusion-check: ERROR ${e.message}`);
    process.exitCode = 2;
    return;
  }

  const identity = identityFrom(args, baseIdentity);
  const evald = evaluateRunStatus(runs, identity);
  const sel = evald.run;

  const report = {
    check: 'workflow-conclusion',
    enforcement: 'post-run oracle (🟦 layered) — owned by validator/orchestrator, NOT a step inside deploy.yml',
    identity,
    decision: evald.decision,
    pass: evald.pass,
    rollback: evald.decision === 'no-go',
    signals: evald.signals,
    reason: evald.reason,
    selectedRun: sel ? {
      runId: sel.runId, headSha: sel.headSha, status: sel.status,
      conclusion: sel.conclusion, runAttempt: sel.runAttempt, workflowName: sel.workflowName,
    } : null,
    consideredRuns: runs.length,
  };

  if (args.json) {
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  } else {
    const verdict = evald.decision === 'go' ? 'GO ✅' : (evald.decision === 'pending' ? 'PENDING ⏳' : 'NO-GO ❌ (rollback)');
    console.log(`workflow-conclusion: ${verdict}  ${report.reason}${sel ? `  [run ${sel.runId} attempt ${sel.runAttempt} → ${sel.conclusion ?? sel.status}]` : ''}`);
    if (evald.signals.length) console.log(`  signals: ${evald.signals.join(', ')}`);
  }

  process.exitCode = evald.pass ? 0 : 1;
}

main().catch((err) => {
  console.error(`workflow-conclusion-check: ERROR ${err.stack ?? err.message}`);
  process.exitCode = 2;
});

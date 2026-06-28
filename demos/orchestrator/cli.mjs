#!/usr/bin/env node
// demos/orchestrator/cli.mjs
// Thin CLI around the pure dispatcher core. Loads a plan.json, prints the dispatch decision, and
// (only with --assign, a T3 / ⛔ external action) assigns parallel-safe units to the Copilot coding
// agent via `gh`. T1/T2 never need --assign.
//
// Usage:
//   node demos/orchestrator/cli.mjs --plan demos/orchestrator/example-plan.json
//   node demos/orchestrator/cli.mjs --plan <plan.json> --landed U1,U2
//   node demos/orchestrator/cli.mjs --plan <plan.json> --assign --repo owner/name --issues U1=12,U2=13,U3=14
//
import { readFileSync } from 'node:fs';
import { decideDispatch, formatDecision } from './dispatch.mjs';

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--plan') args.plan = argv[++i];
    else if (a === '--landed') args.landed = argv[++i].split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--assign') args.assign = true;
    else if (a === '--repo') args.repo = argv[++i];
    else if (a === '--issues') args.issues = argv[++i];
    else if (a === '--json') args.json = true;
    // Loop-3 (M3): --watch run-status mode (G2). Observe the EXACT run for a dispatched unit.
    else if (a === '--watch') args.watch = true;
    else if (a === '--workflow') args.workflow = argv[++i];
    else if (a === '--sha') args.sha = argv[++i];
    else if (a === '--event') args.event = argv[++i];
    else if (a === '--branch') args.branch = argv[++i];
    else if (a === '--report-issue') args.reportIssue = argv[++i];
    else if (a === '--watch-timeout') args.watchTimeout = Number(argv[++i]);
    else if (a === '--watch-interval') args.watchInterval = Number(argv[++i]);
    else if (a === '--max-retries') args.maxRetries = Number(argv[++i]);
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  // Loop-3 (M3): closed-loop watch mode. Observe the exact GitHub Actions run for a dispatched
  // unit and react per the PURE retry taxonomy (run-status.mjs#decideReaction). This is the G2
  // fix — the orchestrator is no longer fire-and-forget.
  if (args.watch) {
    const code = await watchRunStatus(args);
    process.exit(code);
  }

  if (!args.plan) {
    console.error('error: --plan <path> is required');
    process.exit(2);
  }
  const plan = JSON.parse(readFileSync(args.plan, 'utf8'));
  const decision = decideDispatch(plan, { landed: args.landed ?? [] });

  if (args.json) {
    console.log(JSON.stringify(decision, null, 2));
  } else {
    console.log(formatDecision(decision));
  }

  if (args.assign) {
    if (!decision.approved) {
      console.error('\nrefusing to --assign: plan is not approved');
      process.exit(1);
    }
    // R2: AWAIT the assigns. The previous version fired an async import() then fell through to
    // process.exit() below, so the process could die before a single `gh` call ran — reporting
    // a successful fan-out while assigning nothing. Now the assigns complete (and are verified)
    // before we exit, and any `gh` failure propagates as a non-zero exit.
    const assigned = await assignViaGh(decision, plan, args); // ⛔ external dependency (T3 only)
    if (assigned.failed.length > 0) {
      console.error(`\n${assigned.failed.length} assignment(s) FAILED: ${assigned.failed.join(', ')}`);
      process.exit(1);
    }
  }

  // Exit non-zero when an unapproved plan was asked to dispatch, so CI/scripts can detect the gate.
  process.exit(decision.approved ? 0 : 1);
}

// ⛔ EXTERNAL DEPENDENCY (T3). Assigns each dispatched unit's Issue to the Copilot coding agent
// and VERIFIES the assignment landed by reading the issue back. Kept side-effecting and isolated;
// never invoked by the T1 validator. Returns { assigned: string[], failed: string[] }.
async function assignViaGh(decision, plan, args) {
  const issueMap = Object.fromEntries(
    (args.issues ?? '').split(',').map((kv) => kv.split('=')).filter((p) => p.length === 2),
  );
  if (!args.repo) {
    console.error('error: --assign requires --repo owner/name');
    process.exit(2);
  }
  // Lazy import so T1 never loads child_process.
  const { execFileSync } = await import('node:child_process');
  const gh = (gArgs) => execFileSync('gh', gArgs, { encoding: 'utf8' });

  const assigned = [];
  const failed = [];
  for (const id of decision.dispatch) {
    const issue = issueMap[id];
    if (!issue) {
      console.error(`skip ${id}: no --issues mapping (expected ${id}=<issue-number>)`);
      failed.push(`${id}(no-issue-mapping)`);
      continue;
    }
    try {
      console.log(`assigning ${id} → issue #${issue} to @copilot in ${args.repo}`);
      gh(['issue', 'edit', issue, '--repo', args.repo, '--add-assignee', '@copilot']);
      // VERIFY: read the issue back and confirm @copilot (Copilot bot login) is now an assignee.
      const raw = gh(['issue', 'view', issue, '--repo', args.repo, '--json', 'assignees']);
      const logins = (JSON.parse(raw).assignees ?? []).map((a) => (a.login ?? '').toLowerCase());
      const ok = logins.some((l) => l === 'copilot' || l.includes('copilot'));
      if (ok) {
        console.log(`  ✓ verified ${id} → issue #${issue} assigned to @copilot`);
        assigned.push(id);
      } else {
        console.error(`  ✗ ${id} → issue #${issue}: assignment did not stick (assignees: ${logins.join(', ') || '(none)'})`);
        failed.push(`${id}(unverified)`);
      }
    } catch (err) {
      console.error(`  ✗ ${id} → issue #${issue}: gh failed — ${err.message}`);
      failed.push(`${id}(gh-error)`);
    }
  }
  return { assigned, failed };
}

// ⛔ EXTERNAL DEPENDENCY (T3 / Wave-2 live). Loop-3 (M3) closed-loop watch. Polls the EXACT
// GitHub Actions run for a dispatched unit (identity-bound to the head sha + workflow), classifies
// the conclusion with the PURE core, and reacts per the retry taxonomy — retry ONLY transient
// (still-queued past the window), NEVER auto-retry a real failure. Reports a hard failure back to
// the issue when --report-issue is given. Never invoked by the T1 validator.
async function watchRunStatus(args) {
  if (!args.repo || !args.sha) {
    console.error('error: --watch requires --repo owner/name and --sha <headSha>');
    return 2;
  }
  // Lazy imports so the dispatcher / T1 path never loads the gh adapter.
  const { readRuns } = await import('../ci/lib/gh-run-reader.mjs');
  const { evaluateRunStatus, decideReaction } = await import('../ci/lib/run-status.mjs');

  const identity = { headSha: args.sha, repo: args.repo };
  if (args.workflow) identity.workflowName = args.workflow;
  if (args.event) identity.event = args.event;

  const timeoutMs = (args.watchTimeout ?? 600) * 1000;
  const intervalMs = (args.watchInterval ?? 10) * 1000;
  const maxRetries = args.maxRetries ?? 1;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  let attempt = 1;
  let windowStart = Date.now();
  for (;;) {
    let runs = [];
    try {
      runs = await readRuns({ repo: args.repo, workflow: args.workflow, branch: args.branch, event: args.event });
    } catch (err) {
      // A gh/API hiccup is transient — log and let the loop re-poll within the window.
      console.error(`watch: gh read failed (transient) — ${err.message}`);
    }
    const evald = evaluateRunStatus(runs, identity);
    const timedOut = Date.now() - windowStart >= timeoutMs;
    const reaction = decideReaction(evald, { timedOut, attempt, maxRetries });
    const run = evald.run;
    console.log(`watch[${args.repo} ${args.sha.slice(0, 7)}]: ${evald.decision} → ${reaction.action}  (${reaction.reason})${run ? ` [run ${run.runId} attempt ${run.runAttempt} → ${run.conclusion ?? run.status}]` : ''}`);

    if (reaction.action === 'proceed') return 0;
    if (reaction.action === 'wait') { await sleep(intervalMs); continue; }
    if (reaction.action === 'retry') {
      console.log(`  ↻ transient — re-arming watch window (attempt ${attempt + 1}/${maxRetries + 1})`);
      attempt += 1;
      windowStart = Date.now();
      await sleep(intervalMs);
      continue;
    }
    // report-failure — hard failure, never auto-retried.
    if (args.reportIssue) await reportToIssue(args, evald);
    return 1;
  }
}

// Comments a NO-GO back onto the dispatched unit's issue so the failure is visible in the loop
// (closing G2/G3). Best-effort: a reporting failure must not mask the underlying run failure.
async function reportToIssue(args, evald) {
  try {
    const { execFileSync } = await import('node:child_process');
    const run = evald.run;
    const body = [
      `🔴 **Run-status gate: NO-GO** — the harness observed a failing pipeline for \`${args.sha}\`.`,
      ``,
      `- decision: \`${evald.decision}\``,
      `- signals: ${(evald.signals ?? []).map((s) => `\`${s}\``).join(', ') || '(none)'}`,
      `- reason: ${evald.reason}`,
      run ? `- run: \`${run.runId}\` attempt \`${run.runAttempt}\` → \`${run.conclusion ?? run.status}\`` : `- run: (none matched the requested identity)`,
      ``,
      `_Reported automatically by \`orchestrator --watch\` (Loop-3 closed-loop deploy/run-status)._`,
    ].join('\n');
    execFileSync('gh', ['issue', 'comment', String(args.reportIssue), '--repo', args.repo, '--body', body], { encoding: 'utf8' });
    console.log(`  ✓ reported NO-GO to issue #${args.reportIssue}`);
  } catch (err) {
    console.error(`  ✗ failed to report to issue #${args.reportIssue}: ${err.message}`);
  }
}

main();

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
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
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

main();

#!/usr/bin/env node
// LM-judge (OPTIONAL, NON-REQUIRED) — the agent-in-CI half of the evals gate.
//
// HONESTY / fork-PR policy: this is a LAYERED PATTERN and is deliberately OPTIONAL. The
// deterministic eval-rubric + tests are the REQUIRED gate. On public fork PRs there is no
// model token in scope, so this step must NO-OP cleanly (exit 0) rather than fail — never
// let an optional LM-judge block a merge.
//
// In CI the real LM call is made by the `actions/ai-inference` step against GitHub Models;
// this script is the local stand-in / wiring point. With no token it explains itself and
// exits 0. (It does not make a network call here — keeping T1 deterministic and offline.)
//
// Usage:
//   node lm-judge.mjs [--json]                         # CI default: token-gated, advisory, exit 0
//   node lm-judge.mjs --input <fixture.json> [--json]  # validator: deterministic verdict from input
//   node lm-judge.mjs --verdict pass|fail [--json]      # force a verdict (advisory; never blocks)

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function hasModelToken() {
  return Boolean(process.env.GITHUB_TOKEN || process.env.GH_TOKEN || process.env.MODELS_TOKEN);
}

function parseArgs(argv) {
  const args = { json: false };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--json') args.json = true;
    else if (a === '--input') args.input = argv[++i];
    else if (a === '--verdict') args.verdict = argv[++i];
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv);
  let verdict = args.verdict ?? null;     // 'pass' | 'fail' | null
  let tokenPresent = hasModelToken();

  // A validator fixture can carry a deterministic verdict (and force the token mode) so the
  // ADVISORY behavior is provable offline with no network call — Loop-3 M4.
  if (args.input) {
    try {
      const fx = JSON.parse(readFileSync(resolve(args.input), 'utf8'));
      const inp = fx.input ?? fx;
      if (inp.verdict != null) verdict = inp.verdict;
      if (inp.simulateToken != null) tokenPresent = Boolean(inp.simulateToken);
    } catch { /* fall through to env-derived behavior */ }
  }

  // ADVISORY default-on semantics: this step ALWAYS runs and NEVER blocks (exit 0). It records a
  // finding when the judge verdict is 'fail'; with no token + no verdict it skips cleanly.
  const skipped = verdict == null && !tokenPresent;
  const flagged = verdict === 'fail';
  const signals = flagged ? ['advisory-fail'] : [];

  const report = {
    judge: 'lm-judge',
    enforcement: 'default-on but 🟨 advisory / non-required — records findings, NEVER blocks (exit 0)',
    tokenPresent,
    verdict: verdict ?? (skipped ? 'skipped' : 'not-evaluated'),
    skipped,
    flagged,
    signals,
    note: skipped
      ? 'No model token in scope (e.g. fork PR): advisory judge skipped. Deterministic eval-rubric + tests remain the REQUIRED gate.'
      : flagged
        ? 'Advisory judge verdict=FAIL: finding recorded for human review; does NOT block the merge.'
        : 'Advisory judge verdict=PASS (or token present, no fault): no blocking finding.',
    pass: true,
  };

  if (args.json) {
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  } else {
    console.log(`lm-judge: ${skipped ? 'skipped (no token)' : flagged ? 'advisory FAIL recorded (non-blocking)' : 'advisory pass'} — never blocks`);
    console.log(`  ${report.note}`);
  }

  process.exitCode = 0; // never blocks
}

main();

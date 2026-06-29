#!/usr/bin/env node
// Trajectory eval — "did the agent take the right steps?" (a LAYERED PATTERN run as an
// Actions job / local assertion, NOT a native GitHub product).
//
// Unlike path-scope (which checks the agent stayed INSIDE its lane), trajectory checks
// the agent actually DID the declared work:
//   1. touched_declared      — the change touched at least one declared target path
//   2. required_test_added   — the change added the required test/eval file
//   3. no_unrelated_churn    — (advisory) the change didn't touch obviously unrelated areas
//
// PASS = touched_declared && required_test_added. This makes the trajectory NEGATIVE
// bite: an impl that adds the feature but ships NO test → required_test_added FAIL.
//
// Usage:
//   node trajectory-check.mjs --input <fixture.json>
//   node trajectory-check.mjs --declared a,b --changed c,d --required-test path [--json]
//
// fixture.json: { declaredPaths: string[], changedPaths: string[], requiredTest: string }

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function parseArgs(argv) {
  const args = { json: false };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--json') args.json = true;
    else if (a === '--input') args.input = argv[++i];
    else if (a === '--declared') args.declared = argv[++i];
    else if (a === '--changed') args.changed = argv[++i];
    else if (a === '--required-test') args.requiredTest = argv[++i];
  }
  return args;
}

function load(args) {
  if (args.input) {
    const f = JSON.parse(readFileSync(resolve(args.input), 'utf8'));
    return {
      declaredPaths: f.declaredPaths ?? [],
      changedPaths: f.changedPaths ?? [],
      requiredTest: f.requiredTest ?? null,
    };
  }
  const split = (s) => (s ? s.split(',').map((x) => x.trim()).filter(Boolean) : []);
  return {
    declaredPaths: split(args.declared),
    changedPaths: split(args.changed),
    requiredTest: args.requiredTest ?? null,
  };
}

function main() {
  const args = parseArgs(process.argv);
  const { declaredPaths, changedPaths, requiredTest } = load(args);

  const norm = (p) => p.replace(/\\/g, '/');
  const changed = changedPaths.map(norm);
  const declared = declaredPaths.map(norm);

  const touchedDeclared = changed.some((c) => declared.some((d) => c === d || c.startsWith(d.replace(/\/$/, '') + '/')));
  const requiredTestAdded = requiredTest ? changed.includes(norm(requiredTest)) : true;

  const checks = {
    touched_declared: touchedDeclared,
    required_test_added: requiredTestAdded,
  };
  const pass = checks.touched_declared && checks.required_test_added;

  const report = {
    eval: 'trajectory',
    enforcement: 'required CI job (T2) / local assertion (T1) — 🟦 layered eval',
    declaredPaths: declared,
    changedPaths: changed,
    requiredTest,
    checks,
    pass,
  };

  if (args.json) {
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  } else {
    console.log(`trajectory-check: ${pass ? 'PASS ✅' : 'FAIL ❌'}`);
    console.log(`  ${checks.touched_declared ? '✓' : '✗'} touched_declared`);
    console.log(`  ${checks.required_test_added ? '✓' : '✗'} required_test_added${requiredTest ? ` (${requiredTest})` : ''}`);
  }

  process.exitCode = pass ? 0 : 1;
}

main();

#!/usr/bin/env node
// Plan-lint — the deterministic PLAN-ARTIFACT contract check behind the Planning and
// Rubber-Duck gates (🟦 local assertion).
//
// HONESTY: this validates the *artifact contract* of a plan (well-formed DAG, safe
// parallelization), NOT live-agent reasoning quality. It proves the harness LOGIC catches
// the classic planning flaws; whether a live LLM catches them is only exercised in T3.
//
// Rules (each emits a machine-checkable signal):
//   A. ordered-unit-marked-parallel  — a unit with dependsOn[] but parallelSafe:true
//      (a dependent unit cannot be parallel-safe).
//   B. parallel-units-share-path     — two parallelSafe:true units claim the same path
//      (a hidden cross-unit dependency, e.g. a shared limiter store).
//   C. integration-marked-parallel   — an integration/e2e unit marked parallelSafe:true
//      (the ordered integration test must wait for the feature units).
//
// PASS = no violations. The Rubber-Duck NEGATIVE fixture (flawed plan) trips B + C; the
// corrected plan passes. Exit 1 on any violation.
//
// Usage: node plan-lint.mjs --plan <plan.json>  |  --input <fixture-with-input.plan> [--json]

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const args = { json: false };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--json') args.json = true;
    else if (a === '--plan') args.plan = argv[++i];
    else if (a === '--input') args.input = argv[++i];
  }
  return args;
}

function loadPlan(args) {
  if (args.plan) return JSON.parse(readFileSync(resolve(args.plan), 'utf8'));
  if (args.input) {
    const f = JSON.parse(readFileSync(resolve(args.input), 'utf8'));
    return f.input?.plan ?? f.plan ?? f;
  }
  throw new Error('provide --plan <plan.json> or --input <fixture.json>');
}

const INTEGRATION = /(integration|e2e|end-to-end)/i;

async function main() {
  const args = parseArgs(process.argv);
  const plan = loadPlan(args);

  const violations = [];

  const units = Array.isArray(plan.units) ? plan.units : [];

  // Reuse the dispatcher's strict structural validation (ids, unknown deps, cycles) for FULL plans
  // (the tracking/PRD issue). A single work-unit issue, however, is linted in ISOLATION: its
  // cross-unit dependsOn edges reference sibling units that are intentionally absent from a one-unit
  // plan, so the dispatcher's unknown-dep check would mis-fire and flag a perfectly valid ordered
  // unit (e.g. the E2E unit U4 dependsOn U1,U2). The authoritative DAG/structure check runs on the
  // tracking issue (full plan); for a lone unit we apply only the unit-local structural rules
  // (string id, no self-dependency) plus the A/B/C rules below.
  const singleUnit = units.length === 1 || plan.source === 'work-unit-form';
  try {
    const dispatch = await import(pathToFileURL(resolve(HERE, '..', 'lib', 'dispatch.mjs')).href);
    if (!singleUnit) {
      dispatch.validatePlan(plan);
    } else {
      for (const u of units) {
        if (!u || typeof u.id !== 'string') throw new TypeError('every unit needs a string id');
        if ((u.dependsOn ?? []).includes(u.id)) throw new TypeError(`unit ${u.id} depends on itself`);
      }
    }
  } catch (err) {
    violations.push({ rule: 'structure', signal: 'malformed-plan', detail: err.message });
  }

  // Rule A — a dependent unit marked parallel-safe.
  for (const u of units) {
    if ((u.dependsOn ?? []).length > 0 && u.parallelSafe === true) {
      violations.push({
        rule: 'A',
        signal: 'ordered-unit-marked-parallel',
        detail: `${u.id} depends on ${(u.dependsOn ?? []).join(', ')} but is marked parallelSafe:true`,
      });
    }
  }

  // Rule B — two parallel-safe units share an owned path.
  const claimed = new Map(); // path -> first unit id
  for (const u of units) {
    if (u.parallelSafe !== true) continue;
    for (const p of u.paths ?? []) {
      if (claimed.has(p) && claimed.get(p) !== u.id) {
        violations.push({
          rule: 'B',
          signal: 'parallel-units-share-path',
          detail: `${claimed.get(p)} and ${u.id} both claim ${p} while marked parallel-safe (hidden cross-unit dependency)`,
        });
      } else {
        claimed.set(p, u.id);
      }
    }
  }

  // Rule C — an integration/e2e unit marked parallel-safe.
  for (const u of units) {
    const label = `${u.id} ${u.title ?? ''} ${(u.paths ?? []).join(' ')}`;
    if (u.parallelSafe === true && INTEGRATION.test(label)) {
      violations.push({
        rule: 'C',
        signal: 'integration-marked-parallel',
        detail: `${u.id} looks like an integration/e2e unit but is marked parallelSafe:true`,
      });
    }
  }

  const signals = [...new Set(violations.map((v) => v.signal))];
  const pass = violations.length === 0;
  const report = {
    check: 'plan-lint',
    enforcement: 'local-assertion — 🟦 artifact contract (planning / rubber-duck), not live-agent quality',
    units: units.map((u) => u.id),
    violations,
    signals,
    pass,
  };

  if (args.json) {
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  } else {
    console.log(`plan-lint: ${pass ? 'PASS ✅' : 'CAUGHT ❌'}  (${violations.length} violation(s))`);
    for (const v of violations) console.log(`  ✗ [${v.rule}] ${v.signal} — ${v.detail}`);
  }

  process.exitCode = pass ? 0 : 1;
}

main().catch((err) => {
  console.error(`plan-lint: ERROR ${err.message}`);
  process.exitCode = 2;
});

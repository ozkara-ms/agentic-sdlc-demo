#!/usr/bin/env node
// Tier-1 validation runner — the deterministic harness that proves every agent/gate's
// ARTIFACT CONTRACT holds: each positive fixture passes and, crucially, each NEGATIVE
// fixture is CAUGHT. A negative that slips through is "theater" and fails the suite.
//
// SCENARIO-GENERAL (Loop 2): fixtures live under demos/scenarios/<id>/fixtures/<agent>/.
// The runner owns NO scenario knowledge — the acceptance ORACLE (the eval rubric + the
// failed-check → signal mapping) is declared by each scenario (scenario.json + rubric.mjs),
// so adding a new scenario never edits this file. `--scenario <id>` runs one scenario.
//
// HONESTY (per the plan's validation scope): T1 validates harness LOGIC + artifact
// contracts with seeded fixtures — NOT live-agent quality. Live agent behaviour is only
// exercised in T3 (real @copilot fleet). Each row is labelled by enforcement type so
// nothing is presented as a stronger guarantee than it is:
//   🟩 native (GitHub primitive)  🟦 ci-job / local-assertion (our logic)
//   🟨 advisory (non-blocking)    ⛔ external (needs coding-agent / Models / human)
//
// Drivers map a fixture's semantic `input` (CONTRACT §4) to the real D2 check scripts:
//   plan-lint · path-scope · trajectory · eval-rubric · pin-check · doc-coupling · smoke · dispatch
//
// Usage: node demos/validate/run.mjs [--json] [--filter <agent>] [--scenario <id>]
// Exit 0 only if every fixture's actual outcome === its expected outcome (and expected
// signals are present). Exit 1 if any fixture is mis-handled (theater or false block).

import { readdirSync, statSync, readFileSync, existsSync } from 'node:fs';
import { resolve, dirname, join, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEMOS = resolve(HERE, '..');
const ROOT = resolve(DEMOS, '..');
const SCENARIOS = join(DEMOS, 'scenarios');
const CI_SCRIPTS = join(DEMOS, 'ci', 'scripts');
const SAMPLE_APP = join(DEMOS, 'sample-app');
const APP_DIST = join(SAMPLE_APP, 'dist', 'app.js');

const ENFORCE_EMOJI = {
  native: '🟩 native',
  'ci-job': '🟦 ci-job',
  'local-assertion': '🟦 local',
  advisory: '🟨 advisory',
  external: '⛔ external',
};

function parseArgs(argv) {
  const args = { json: false, filter: null, scenario: null };
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === '--json') args.json = true;
    else if (argv[i] === '--filter') args.filter = argv[++i];
    else if (argv[i] === '--scenario') args.scenario = argv[++i];
  }
  return args;
}

function walk(dir) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (name.endsWith('.json')) out.push(p);
  }
  return out;
}

// Scenario manifests are loaded once and cached by id.
const manifestCache = new Map();
function loadManifest(scenarioId) {
  if (manifestCache.has(scenarioId)) return manifestCache.get(scenarioId);
  const p = join(SCENARIOS, scenarioId, 'scenario.json');
  let manifest = { id: scenarioId, title: scenarioId };
  try { manifest = { id: scenarioId, ...JSON.parse(readFileSync(p, 'utf8')) }; } catch { /* default */ }
  manifestCache.set(scenarioId, manifest);
  return manifest;
}

function loadFixtures() {
  return walk(SCENARIOS)
    .map((p) => {
      // Only files under demos/scenarios/<id>/fixtures/** are fixtures.
      const rel = relative(SCENARIOS, p).split(sep);
      if (rel.length < 3 || rel[1] !== 'fixtures') return null;
      const scenarioId = rel[0];
      try {
        const json = JSON.parse(readFileSync(p, 'utf8'));
        if (!json || !json.agent || !json.expect) return null; // skip data files (e.g. bad-deps-package.json)
        const manifest = loadManifest(scenarioId);
        return {
          path: p,
          scenario: scenarioId,
          scenarioDir: join(SCENARIOS, scenarioId),
          manifest,
          ...json,
        };
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => (a.scenario + a.agent + a.case).localeCompare(b.scenario + b.agent + b.case));
}

function matchesScenario(scenarioId, arg) {
  if (!arg) return true;
  return scenarioId === arg || scenarioId.split('-')[0] === arg;
}

function runScript(scriptName, args) {
  const script = join(CI_SCRIPTS, scriptName);
  try {
    const stdout = execFileSync(process.execPath, [script, ...args], { encoding: 'utf8' });
    return { status: 0, stdout };
  } catch (e) {
    return { status: e.status ?? 2, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
}

function parseJson(stdout) {
  try { return JSON.parse(stdout); } catch { return null; }
}

const split = (arr) => (arr ?? []).join(',');

// Each driver returns { outcome: 'pass'|'blocked'|'error', signals: string[] }.
const drivers = {
  'plan-lint'(fx) {
    const r = runScript('plan-lint.mjs', ['--input', fx.path, '--json']);
    const j = parseJson(r.stdout);
    if (!j) return { outcome: 'error', signals: [] };
    return { outcome: j.pass ? 'pass' : 'blocked', signals: j.signals ?? [] };
  },

  'path-scope'(fx) {
    const { declaredPaths, changedPaths } = fx.input;
    const r = runScript('path-scope-check.mjs', ['--declared', split(declaredPaths), '--changed', split(changedPaths), '--json']);
    const j = parseJson(r.stdout);
    if (!j) return { outcome: 'error', signals: [] };
    return { outcome: j.pass ? 'pass' : 'blocked', signals: j.pass ? [] : ['path-violation'] };
  },

  trajectory(fx) {
    const { declaredPaths, changedPaths, requiredTest } = fx.input;
    const a = ['--declared', split(declaredPaths), '--changed', split(changedPaths), '--json'];
    if (requiredTest) a.push('--required-test', requiredTest);
    const r = runScript('trajectory-check.mjs', a);
    const j = parseJson(r.stdout);
    if (!j) return { outcome: 'error', signals: [] };
    const signals = [];
    if (!j.checks?.touched_declared) signals.push('untouched-declared');
    if (!j.checks?.required_test_added) signals.push('missing-required-test');
    return { outcome: j.pass ? 'pass' : 'blocked', signals };
  },

  // Scenario-general: load the scenario's declared rubric + the variant the fixture names,
  // and trust the rubric's OWN failed-check signals. No 429/threshold knowledge lives here.
  'eval-rubric'(fx) {
    const rubric = resolve(fx.scenarioDir, fx.manifest.evalRubric ?? 'rubric.mjs');
    const variant = resolve(fx.scenarioDir, 'variants', `${fx.input.appVariant}.mjs`);
    const a = ['--app', APP_DIST, '--variant', variant, '--rubric', rubric, '--json'];
    const d = fx.manifest.evalDefaults ?? {};
    if (d.route) a.push('--route', d.route);
    if (d.method) a.push('--method', d.method);
    if (d.max != null) a.push('--max', String(d.max));
    const r = runScript('eval-rubric.mjs', a);
    const j = parseJson(r.stdout);
    if (!j) return { outcome: 'error', signals: [] };
    return { outcome: j.pass ? 'pass' : 'blocked', signals: j.signals ?? [] };
  },

  'pin-check'(fx) {
    const manifest = resolve(ROOT, fx.input.manifest);
    const r = runScript('pin-check.mjs', ['--package', manifest, '--json']);
    const j = parseJson(r.stdout);
    if (!j) return { outcome: 'error', signals: [] };
    const kinds = [...new Set((j.findings ?? []).map((f) => f.kind))];
    return { outcome: j.pass ? 'pass' : 'blocked', signals: kinds };
  },

  'doc-coupling'(fx) {
    const r = runScript('doc-coupling-check.mjs', ['--changed', split(fx.input.changedPaths), '--json']);
    const j = parseJson(r.stdout);
    if (!j) return { outcome: 'error', signals: [] };
    // Advisory: the gate "fires" when flagged, even though it exits 0 (non-blocking).
    return { outcome: j.flagged ? 'blocked' : 'pass', signals: j.signals ?? [] };
  },

  smoke(fx) {
    const a = ['--app', APP_DIST, '--json'];
    if (fx.input.variant) a.push('--variant', resolve(dirname(fx.path), fx.input.variant));
    const r = runScript('smoke-check.mjs', a);
    const j = parseJson(r.stdout);
    if (!j) return { outcome: 'error', signals: [] };
    return { outcome: j.pass ? 'pass' : 'blocked', signals: j.signals ?? [] };
  },

  // Loop-3 (M2): the Deployment gate's run-conclusion oracle. The fixture's `input` carries a
  // canned `runs` array + `identity`; the pure run-status core decides GO/NO-GO. A red pipeline
  // is replayable JSON here — never a live one-shot. (G1+G3)
  'workflow-conclusion'(fx) {
    const r = runScript('workflow-conclusion-check.mjs', ['--input', fx.path, '--json']);
    const j = parseJson(r.stdout);
    if (!j) return { outcome: 'error', signals: [] };
    return { outcome: j.pass ? 'pass' : 'blocked', signals: j.signals ?? [] };
  },

  // Loop-3 (M4): the LM-judge is ADVISORY default-on. The script ALWAYS exits 0 (never blocks);
  // it "fires" (records a finding) when the judge verdict is fail. We map a recorded finding to
  // 'blocked' here ONLY to prove the advisory gate fires deterministically — exactly like the
  // doc-coupling advisory gate. The real merge is never blocked by it.
  'lm-judge'(fx) {
    const r = runScript('lm-judge.mjs', ['--input', fx.path, '--json']);
    const j = parseJson(r.stdout);
    if (!j) return { outcome: 'error', signals: [] };
    return { outcome: j.flagged ? 'blocked' : 'pass', signals: j.signals ?? [] };
  },

  async dispatch(fx) {
    const mod = await import(pathToFileURL(join(DEMOS, 'orchestrator', 'dispatch.mjs')).href);
    const plan = {
      intent: 'fixture',
      planApproved: fx.input.planApprovedLabel === true,
      units: fx.input.units,
    };
    let decision;
    try {
      decision = mod.decideDispatch(plan);
    } catch (e) {
      return { outcome: 'error', signals: [e.message] };
    }
    if (!decision.approved) return { outcome: 'blocked', signals: ['refused-unapproved'] };
    return { outcome: decision.dispatch.length > 0 ? 'pass' : 'blocked', signals: ['dispatched'] };
  },
};

function ensureBuilt() {
  if (existsSync(APP_DIST)) return;
  const tsc = join(SAMPLE_APP, 'node_modules', 'typescript', 'bin', 'tsc');
  if (!existsSync(tsc)) {
    throw new Error(`sample app not built and tsc not found. Run \`npm install && npm run build\` in ${SAMPLE_APP}.`);
  }
  console.log('• sample app not built — compiling (tsc)…');
  execFileSync(process.execPath, [tsc, '-p', join(SAMPLE_APP, 'tsconfig.json')], { stdio: 'inherit' });
}

async function main() {
  const args = parseArgs(process.argv);
  ensureBuilt();

  let fixtures = loadFixtures();
  if (args.scenario) fixtures = fixtures.filter((f) => matchesScenario(f.scenario, args.scenario));
  if (args.filter) fixtures = fixtures.filter((f) => f.agent === args.filter);

  if (fixtures.length === 0) {
    const known = [...new Set(loadFixtures().map((f) => f.scenario))];
    console.error(`validate: no fixtures matched (scenario=${args.scenario ?? '*'}, filter=${args.filter ?? '*'}). Known scenarios: ${known.join(', ') || '(none)'}`);
    process.exitCode = 2;
    return;
  }

  const results = [];
  for (const fx of fixtures) {
    const driver = drivers[fx.driver];
    if (!driver) {
      results.push({ fx, actual: { outcome: 'error', signals: [] }, ok: false, reason: `unknown driver "${fx.driver}"` });
      continue;
    }
    const actual = await driver(fx);
    const outcomeOk = actual.outcome === fx.expect.outcome;
    const signalsOk = (fx.expect.signals ?? []).every((s) => actual.signals.includes(s));
    const ok = outcomeOk && signalsOk;
    let reason = 'ok';
    if (!outcomeOk) {
      reason = fx.polarity === 'negative' ? 'THEATER: negative not caught' : 'FALSE-BLOCK: positive wrongly blocked';
    } else if (!signalsOk) {
      reason = `signal mismatch: expected [${(fx.expect.signals ?? []).join(', ')}] got [${actual.signals.join(', ')}]`;
    }
    results.push({ fx, actual, ok, reason });
  }

  const passed = results.filter((r) => r.ok).length;
  const failed = results.length - passed;

  if (args.json) {
    process.stdout.write(JSON.stringify({
      total: results.length,
      passed,
      failed,
      results: results.map((r) => ({
        scenario: r.fx.scenario, agent: r.fx.agent, case: r.fx.case, polarity: r.fx.polarity,
        enforcement: r.fx.enforcement, driver: r.fx.driver,
        expected: r.fx.expect.outcome, actual: r.actual.outcome,
        signals: r.actual.signals, ok: r.ok, reason: r.reason,
      })),
    }, null, 2) + '\n');
  } else {
    printMatrix(results);
  }

  process.exitCode = failed === 0 ? 0 : 1;
}

function printMatrix(results) {
  console.log('\n  Tier-1 harness validation — artifact contracts (seeded fixtures, not live-agent quality)\n');

  // Group by scenario, then agent, so a multi-scenario run stays readable.
  const byScenario = new Map();
  for (const r of results) {
    if (!byScenario.has(r.fx.scenario)) byScenario.set(r.fx.scenario, []);
    byScenario.get(r.fx.scenario).push(r);
  }

  for (const [scenario, srows] of byScenario) {
    const title = srows[0]?.fx.manifest?.title ?? scenario;
    const sPass = srows.filter((r) => r.ok).length;
    const sNeg = srows.filter((r) => r.fx.polarity === 'negative');
    const sNegCaught = sNeg.filter((r) => r.ok).length;
    console.log(`  ╔══ scenario: ${scenario} — ${title}`);
    console.log(`  ║   ${sPass}/${srows.length} fixtures correct · negatives caught ${sNegCaught}/${sNeg.length}\n`);

    const byAgent = new Map();
    for (const r of srows) {
      if (!byAgent.has(r.fx.agent)) byAgent.set(r.fx.agent, []);
      byAgent.get(r.fx.agent).push(r);
    }
    for (const [agent, rows] of byAgent) {
      console.log(`  ║ ${agent}`);
      for (const r of rows) {
        const mark = r.ok ? '✅' : '❌';
        const pol = r.fx.polarity === 'negative' ? 'neg' : 'pos';
        const enf = ENFORCE_EMOJI[r.fx.enforcement] ?? r.fx.enforcement;
        const detail = r.ok
          ? `${r.fx.expect.outcome}`
          : `${r.reason}  (expected ${r.fx.expect.outcome}, got ${r.actual.outcome})`;
        console.log(`  ║   ${mark} [${pol}] ${enf.padEnd(12)} ${r.fx.case}`);
        console.log(`  ║        → ${detail}`);
      }
    }
    console.log('  ╚════════════════════════════════════════════\n');
  }

  // Human gates are not executable in T1 — surface them as INFO so the matrix is complete.
  console.log('  human-gates (not executed in T1 — native/external; verified in T2/T3)');
  console.log('    ℹ️ [info] 🟩 native     plan-approved label — required before dispatch (human)');
  console.log('    ℹ️ [info] 🟩 native     CODEOWNERS review — required to merge each PR (human)');
  console.log('    ℹ️ [info] 🟩 native     Environment approval — required before release (human)');
  console.log('');

  // The Deployment gate's TRUE enforcement is a split label, only fully present at T2 (Azure).
  // T1 above proves the 🟦 rollback LOGIC with a local fixture; the live deploy adds the rest.
  console.log('  tier-2 live deployment (Azure Container Apps — verified by deploy.yml, not in T1)');
  console.log('    ℹ️ [info] 🟩 native     production Environment reviewer + GitHub Deployment record');
  console.log('    ℹ️ [info] 🟦 layered    live /healthz smoke (retries) + revision-traffic rollback');
  console.log('    ℹ️ [info] ⛔ external    Azure Container Apps — external dependency, never a native GitHub block');
  console.log('');

  const passed = results.filter((r) => r.ok).length;
  const failed = results.length - passed;
  const negatives = results.filter((r) => r.fx.polarity === 'negative');
  const negCaught = negatives.filter((r) => r.ok).length;
  const scenarios = [...new Set(results.map((r) => r.fx.scenario))];
  console.log(`  ─────────────────────────────────────────────`);
  console.log(`  scenarios: ${scenarios.join(', ')}`);
  console.log(`  ${failed === 0 ? '✅ ALL GREEN' : '❌ FAILURES'}  ${passed}/${results.length} fixtures correct`);
  console.log(`  negatives caught (anti-theater): ${negCaught}/${negatives.length}`);
  if (failed > 0) {
    console.log('\n  Mis-handled fixtures:');
    for (const r of results.filter((x) => !x.ok)) {
      console.log(`    ✗ ${r.fx.scenario}/${r.fx.agent}/${r.fx.case} — ${r.reason}`);
    }
  }
  console.log('');
}

main().catch((err) => {
  console.error(`validate: ERROR ${err.stack ?? err.message}`);
  process.exitCode = 2;
});

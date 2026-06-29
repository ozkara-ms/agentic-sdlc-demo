#!/usr/bin/env node
// issue-to-plan — turn a GitHub Issue body into the plan JSON that plan-lint.mjs consumes (R3).
//
// HONESTY / enforcement: 🟦 layered orchestration. An `on: issues` workflow can't attach a native
// required *status check* (those bind to commits/PRs), so the Planning / Rubber-Duck gate on an issue
// is: this parser → plan-lint → a verdict COMMENT + the workflow run's pass/fail. The human reads the
// verdict before adding `plan-approved`; the dispatcher then refuses to fan out an unapproved plan.
// This is the issue-native half of the planning gate the rubber-duck (R3) found missing.
//
// Two input shapes are supported, in priority order:
//   1. TRACKING / PRD issue — the Planning agent embeds a machine-readable plan in a fenced block:
//          ```json agentic-plan
//          { "intent": "...", "units": [ { "id":"U1","title":"…","paths":[…],
//                                          "parallelSafe":true,"dependsOn":[] }, … ] }
//          ```
//      (a plain ```json fence is also accepted if it parses to an object with `units`).
//   2. SINGLE work-unit issue — assembled from the `work-unit.yml` issue-form headings
//      (### Declared paths (lane) / ### Parallel-safe? / ### Dependencies / the issue title) into a
//      one-unit plan, so an individual unit issue can be linted too.
//
// Usage:
//   node issue-to-plan.mjs --body-file <path> [--title "<issue title>"] [--out plan.json] [--json]
//   node issue-to-plan.mjs --issue <n> --repo <owner/repo> [--out plan.json]   (shells to `gh`)
//   cat body.md | node issue-to-plan.mjs --stdin --title "[unit]: limiter middleware"

import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

function parseArgs(argv) {
  const a = { json: false };
  for (let i = 2; i < argv.length; i += 1) {
    const k = argv[i];
    if (k === '--json') a.json = true;
    else if (k === '--stdin') a.stdin = true;
    else if (k === '--body-file') a.bodyFile = argv[++i];
    else if (k === '--title') a.title = argv[++i];
    else if (k === '--issue') a.issue = argv[++i];
    else if (k === '--repo') a.repo = argv[++i];
    else if (k === '--out') a.out = argv[++i];
  }
  return a;
}

function readBody(args) {
  if (args.bodyFile) return readFileSync(args.bodyFile, 'utf8');
  if (args.issue) {
    const out = execFileSync('gh', ['issue', 'view', String(args.issue), '--repo', args.repo, '--json', 'title,body'], {
      encoding: 'utf8',
    });
    const j = JSON.parse(out);
    if (!args.title) args.title = j.title;
    return j.body ?? '';
  }
  if (args.stdin) return readFileSync(0, 'utf8');
  throw new Error('provide --body-file <path>, --issue <n> --repo <owner/repo>, or --stdin');
}

// ---- shape 1: embedded machine-readable plan -------------------------------
function extractEmbeddedPlan(body) {
  const text = body.replace(/\r\n/g, '\n');
  // Prefer a fence explicitly tagged agentic-plan; fall back to any ```json fence that parses to {units}.
  const fences = [...text.matchAll(/```([^\n]*)\n([\s\S]*?)```/g)];
  const tagged = fences.find((m) => /agentic-plan/i.test(m[1]));
  const candidates = tagged ? [tagged] : fences.filter((m) => /json/i.test(m[1]));
  for (const m of candidates) {
    try {
      const obj = JSON.parse(m[2]);
      if (obj && Array.isArray(obj.units)) return obj;
    } catch {
      /* try next fence */
    }
  }
  return null;
}

// ---- shape 2: assemble one unit from the work-unit issue form --------------
function sectionValue(body, label) {
  // GitHub renders an issue-form field as "### <label>\n\n<value>" up to the next "### " or EOF.
  const text = body.replace(/\r\n/g, '\n');
  const re = new RegExp(`(?:^|\\n)#{2,4}\\s*${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\n([\\s\\S]*?)(?=\\n#{2,4}\\s|$)`, 'i');
  const m = text.match(re);
  if (!m) return '';
  const v = m[1].trim();
  return /^_no response_$/i.test(v) ? '' : v;
}

function assembleSingleUnit(body, title) {
  const cleanTitle = (title ?? '').replace(/^\[unit\]:\s*/i, '').trim() || 'U1';
  const id = (cleanTitle.match(/\bU\d+\b/) ?? ['U1'])[0];

  const pathsRaw = sectionValue(body, 'Declared paths (lane)') || sectionValue(body, 'Declared paths');
  const paths = pathsRaw
    .split('\n')
    .map((s) => s.replace(/^[-*]\s*/, '').trim())
    .filter(Boolean);

  const parallelRaw = sectionValue(body, 'Parallel-safe?');
  const parallelSafe = /^yes/i.test(parallelRaw);

  const depsRaw = sectionValue(body, 'Dependencies');
  const dependsOn = [...depsRaw.matchAll(/\bU\d+\b|#\d+/g)].map((x) => x[0]);

  const requiredTest = sectionValue(body, 'Required test (trajectory)') || sectionValue(body, 'Required test');
  const evalContract = sectionValue(body, 'Acceptance eval contract (optional)') || sectionValue(body, 'Acceptance eval contract');

  const unit = { id, title: cleanTitle, paths, parallelSafe, dependsOn };
  if (requiredTest) unit.requiredTest = requiredTest;
  if (evalContract) {
    const [name, route, max, method] = evalContract.split(':');
    unit.evals = [name];
    if (route) unit.evalRoute = route;
    if (max) unit.evalMax = Number(max);
    if (method) unit.evalMethod = method;
  }
  return { intent: cleanTitle, units: [unit], source: 'work-unit-form' };
}

function main() {
  const args = parseArgs(process.argv);
  const body = readBody(args);

  let plan = extractEmbeddedPlan(body);
  if (plan) {
    plan.source = plan.source ?? 'embedded-agentic-plan';
  } else {
    plan = assembleSingleUnit(body, args.title);
  }

  const text = JSON.stringify(plan, null, 2) + '\n';
  if (args.out) writeFileSync(args.out, text);
  if (args.json || !args.out) process.stdout.write(text);
}

main();

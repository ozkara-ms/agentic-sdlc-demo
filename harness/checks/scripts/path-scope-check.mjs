#!/usr/bin/env node
// Path-scope check — "did the agent stay in its lane?" (a custom 🟦 required CI job,
// NOT a native GitHub primitive).
//
// Each fleet PR declares the paths its work unit owns. This asserts every changed file
// matches at least one declared path/glob — so a dev agent can't silently edit another
// unit's files (which would break genuine parallel-safety). Any stray file → RED.
//
// This makes the dev-fleet NEGATIVE bite: a PR straying outside its declared paths fails.
//
// Usage:
//   node path-scope-check.mjs --input <fixture.json>
//   node path-scope-check.mjs --declared 'src/mw/**,test/mw/**' --changed a,b [--json]
//
// fixture.json: { declaredPaths: string[], changedPaths: string[] }
// Glob support: `*` = any run except `/`; `**` = any run including `/`; a bare
// directory prefix (e.g. "src/mw/") matches everything beneath it.

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
  }
  return args;
}

function load(args) {
  if (args.input) {
    const f = JSON.parse(readFileSync(resolve(args.input), 'utf8'));
    return { declaredPaths: f.declaredPaths ?? [], changedPaths: f.changedPaths ?? [] };
  }
  const split = (s) => (s ? s.split(',').map((x) => x.trim()).filter(Boolean) : []);
  return { declaredPaths: split(args.declared), changedPaths: split(args.changed) };
}

function globToRegExp(glob) {
  let g = glob.replace(/\\/g, '/');
  // A bare directory prefix matches everything beneath it.
  if (g.endsWith('/')) g += '**';
  // Escape regex metachars except * and /.
  let re = '';
  for (let i = 0; i < g.length; i += 1) {
    const c = g[i];
    if (c === '*') {
      if (g[i + 1] === '*') {
        re += '.*';
        i += 1;
        if (g[i + 1] === '/') i += 1; // consume the slash after **
      } else {
        re += '[^/]*';
      }
    } else if ('.+?^${}()|[]\\'.includes(c)) {
      re += '\\' + c;
    } else {
      re += c;
    }
  }
  return new RegExp('^' + re + '$');
}

function main() {
  const args = parseArgs(process.argv);
  const { declaredPaths, changedPaths } = load(args);

  const norm = (p) => p.replace(/\\/g, '/');
  const matchers = declaredPaths.map((d) => ({ glob: d, re: globToRegExp(d) }));
  const changed = changedPaths.map(norm);

  const violations = [];
  for (const c of changed) {
    const ok = matchers.some((m) => m.re.test(c));
    if (!ok) violations.push(c);
  }

  const pass = violations.length === 0;
  const report = {
    check: 'path-scope',
    enforcement: 'required CI job — 🟦 custom logic (not a native GitHub primitive)',
    declaredPaths,
    changedPaths: changed,
    violations,
    pass,
  };

  if (args.json) {
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  } else {
    console.log(`path-scope-check: ${pass ? 'PASS ✅' : 'FAIL ❌'}  (${violations.length} stray file(s))`);
    for (const v of violations) {
      console.log(`  ✗ ${v} — outside declared paths [${declaredPaths.join(', ')}]`);
    }
  }

  process.exitCode = pass ? 0 : 1;
}

main();

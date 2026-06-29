#!/usr/bin/env node
// Doc-coupling — the deterministic proxy behind the Code-Review gate.
//
// ADVISORY by design (🟨): an architecture-affecting change that ships without a docs
// update gets FLAGGED, but the flag does NOT block merge on its own. The native block in
// T2 is a required CODEOWNERS review (🟩); this script only models the reviewer's
// "you changed the shape of the system but not the docs" comment as a checkable signal.
//
// Rule: if any changed path matches an arch glob AND no changed path matches a doc glob,
//   → flagged: true, signal "missing-doc-update".
//
// Because it is advisory, the script ALWAYS exits 0 (it never breaks CI). Callers read the
// JSON `flagged` field; the Tier-1 validator asserts the negative fixture was *flagged*
// (caught) while recording the enforcement as advisory (suite does not fail on advisory).
//
// Usage:
//   node doc-coupling-check.mjs --changed a.ts,b.md  [--arch '**/src/app.ts,**/src/middleware/**'] [--docs '**/README.md,docs/**'] [--json]
//   node doc-coupling-check.mjs --input <fixture.json>   (reads input.changedPaths / input.archGlobs / input.docGlobs)

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const DEFAULT_ARCH = ['**/src/app.ts', '**/src/middleware/**', '**/src/server.ts'];
const DEFAULT_DOCS = ['**/README.md', 'docs/**', '**/*.md'];

function parseArgs(argv) {
  const args = { json: false };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--json') args.json = true;
    else if (a === '--changed') args.changed = argv[++i];
    else if (a === '--arch') args.arch = argv[++i];
    else if (a === '--docs') args.docs = argv[++i];
    else if (a === '--input') args.input = argv[++i];
  }
  return args;
}

// Minimal glob → RegExp: supports **, *, and literal segments.
function globToRegExp(glob) {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  const re = escaped
    .replace(/\*\*\//g, '§§')      // **/ → any dirs (incl. none)
    .replace(/\*\*/g, '§')          // ** → anything
    .replace(/\*/g, '[^/]*')        // * → non-slash run
    .replace(/§§/g, '(?:.*/)?')
    .replace(/§/g, '.*');
  return new RegExp(`^${re}$`);
}

function matchesAny(path, globs) {
  const norm = path.replace(/\\/g, '/');
  return globs.some((g) => globToRegExp(g).test(norm));
}

function main() {
  const args = parseArgs(process.argv);

  let changed = [];
  let archGlobs = DEFAULT_ARCH;
  let docGlobs = DEFAULT_DOCS;

  if (args.input) {
    const f = JSON.parse(readFileSync(resolve(args.input), 'utf8'));
    const inp = f.input ?? f;
    changed = inp.changedPaths ?? [];
    if (inp.archGlobs) archGlobs = inp.archGlobs;
    if (inp.docGlobs) docGlobs = inp.docGlobs;
  } else {
    changed = (args.changed ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    if (args.arch) archGlobs = args.arch.split(',').map((s) => s.trim()).filter(Boolean);
    if (args.docs) docGlobs = args.docs.split(',').map((s) => s.trim()).filter(Boolean);
  }

  const archChanged = changed.filter((p) => matchesAny(p, archGlobs));
  const docChanged = changed.filter((p) => matchesAny(p, docGlobs));
  const flagged = archChanged.length > 0 && docChanged.length === 0;

  const report = {
    check: 'doc-coupling',
    enforcement: 'advisory (🟨 LM/reviewer comment, non-blocking) — native block is required CODEOWNERS review (🟩)',
    changed,
    archChanged,
    docChanged,
    flagged,
    signals: flagged ? ['missing-doc-update'] : [],
    // For an advisory check, "pass" means "no concern raised". The validator treats a
    // flagged negative fixture as CAUGHT (correct) without failing the suite.
    pass: !flagged,
  };

  if (args.json) {
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  } else if (flagged) {
    console.log(`doc-coupling: ADVISORY FLAG ⚠  arch changed (${archChanged.join(', ')}) with no doc update`);
  } else {
    console.log('doc-coupling: clear ✅  (docs updated alongside arch, or no arch change)');
  }

  // Advisory: never break CI.
  process.exitCode = 0;
}

main();

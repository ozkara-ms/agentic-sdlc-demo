#!/usr/bin/env node
// Supply-chain pin & slopsquat check (the real "Hallucinated-dependency / slopsquatting
// check" job — a custom 🟦 required CI job, NOT a native GitHub primitive).
//
// Deterministic, offline checks over a package.json. The HONEST definition of "pinned":
// a caret/tilde range IS acceptable WHEN a committed lockfile resolves it to an exact,
// integrity-hashed version — that is the standard, secure Node pinning pattern. So we do
// NOT punish ordinary `^4.19.2` ranges on a repo that ships a lockfile. We flag the things
// that are actually dangerous:
//   1. SLOPSQUAT  — a name that is a likely typo/hallucination of a well-known package
//                   (Levenshtein distance 1 from the allowlist) or on a known-slop denylist.
//   2. MUTABLE    — a truly floating/mutable spec (`*`, `x`, `latest`, `>=`, `||`) or a
//                   non-registry source (git/url/file/link/workspace) that bypasses
//                   lockfile integrity.
//   3. NO-LOCKFILE— no package-lock.json / npm-shrinkwrap.json committed, so ranges are
//                   not reproducibly pinned at all.
//   4. UNLOCKED   — a dependency absent from the committed lockfile.
//
// Exit 1 if any finding (gate is RED). This makes the Security NEGATIVE fixture bite: a
// synthetic package.json with `expresss` (typo) + a `latest`/`*` dep → RED, while the
// legitimate sample app (caret ranges + lockfile) stays GREEN.
//
// Usage: node pin-check.mjs --package <package.json> [--json]

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

// Popular, real packages used for the typosquat distance check.
const WELL_KNOWN = [
  'express', 'lodash', 'react', 'react-dom', 'vue', 'next', 'axios', 'chalk',
  'commander', 'dotenv', 'zod', 'vitest', 'jest', 'supertest', 'typescript',
  'eslint', 'prettier', 'nodemon', 'ts-node', 'tsx', 'undici', 'fastify',
  'mongoose', 'pg', 'redis', 'cors', 'helmet', 'morgan', 'uuid', 'dayjs',
  'rate-limiter-flexible', 'express-rate-limit',
];

// Names that are not a single typo away but are known hallucination/slop patterns.
const DENYLIST = ['node-fetch-real', 'express-helper-utils', 'left-pad-secure'];

function parseArgs(argv) {
  const args = { json: false };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--json') args.json = true;
    else if (a === '--package') args.package = argv[++i];
  }
  if (!args.package) args.package = resolve(HERE, '..', '..', 'sample-app', 'package.json');
  return args;
}

function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j += 1) d[0][j] = j;
  for (let i = 1; i <= m; i += 1) {
    for (let j = 1; j <= n; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
    }
  }
  return d[m][n];
}

// 'exact' | 'range' (caret/tilde — OK if locked) | 'mutable' | 'source'
function classifySpec(spec) {
  if (typeof spec !== 'string') return 'mutable';
  const s = spec.trim();
  if (/^(git|github:|gitlab:|bitbucket:|file:|link:|workspace:|http:|https:|npm:)/i.test(s)) return 'source';
  if (/^\d+\.\d+\.\d+([-+][0-9A-Za-z.-]+)?$/.test(s)) return 'exact';
  if (/^[\^~]\d+\.\d+\.\d+([-+][0-9A-Za-z.-]+)?$/.test(s)) return 'range';
  return 'mutable'; // *, x, latest, >=, <, ||, hyphen ranges, empty, etc.
}

function findLockfile(pkgPath) {
  const dir = dirname(resolve(pkgPath));
  for (const name of ['package-lock.json', 'npm-shrinkwrap.json']) {
    const p = join(dir, name);
    if (existsSync(p)) return p;
  }
  return null;
}

function lockedNames(lockPath) {
  const names = new Set();
  try {
    const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
    for (const key of Object.keys(lock.packages ?? {})) {
      if (!key) continue;
      const idx = key.lastIndexOf('node_modules/');
      if (idx === -1) continue;
      names.add(key.slice(idx + 'node_modules/'.length));
    }
    // lockfileVersion 1 fallback
    for (const name of Object.keys(lock.dependencies ?? {})) names.add(name);
  } catch {
    /* ignore parse errors; treated as no coverage */
  }
  return names;
}

function slopReason(name) {
  if (DENYLIST.includes(name)) return 'on known-slop denylist';
  if (WELL_KNOWN.includes(name)) return null;
  for (const known of WELL_KNOWN) {
    if (Math.abs(known.length - name.length) <= 1 && levenshtein(name, known) === 1) {
      return `looks like a typo of "${known}" (Levenshtein distance 1)`;
    }
  }
  return null;
}

function main() {
  const args = parseArgs(process.argv);
  const pkg = JSON.parse(readFileSync(resolve(args.package), 'utf8'));
  const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };

  const lockPath = findLockfile(args.package);
  const locked = lockPath ? lockedNames(lockPath) : new Set();

  const findings = [];
  if (!lockPath && Object.keys(deps).length > 0) {
    findings.push({ name: '(repo)', spec: '-', kind: 'no-lockfile', detail: 'no package-lock.json / npm-shrinkwrap.json committed — ranges are not reproducibly pinned' });
  }

  for (const [name, spec] of Object.entries(deps)) {
    const slop = slopReason(name);
    if (slop) findings.push({ name, spec, kind: 'slopsquat', detail: slop });

    const cls = classifySpec(spec);
    if (cls === 'mutable' || cls === 'source') {
      findings.push({ name, spec, kind: 'mutable', detail: `spec "${spec}" is mutable/non-registry — bypasses reproducible pinning` });
    } else if (cls === 'range' && lockPath && !locked.has(name)) {
      findings.push({ name, spec, kind: 'unlocked', detail: `range "${spec}" is not resolved in the committed lockfile` });
    } else if (cls === 'range' && !lockPath) {
      findings.push({ name, spec, kind: 'unpinned', detail: `range "${spec}" with no lockfile to pin it` });
    }
  }

  const pass = findings.length === 0;
  const report = {
    check: 'supply-chain pin & slopsquat',
    enforcement: 'required CI job — 🟦 custom logic (not a native GitHub primitive)',
    package: args.package,
    lockfile: lockPath,
    dependencyCount: Object.keys(deps).length,
    findings,
    pass,
  };

  if (args.json) {
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  } else {
    console.log(`pin-check: ${pass ? 'PASS ✅' : 'FAIL ❌'}  (${Object.keys(deps).length} deps, lockfile=${lockPath ? 'yes' : 'NO'}, ${findings.length} finding(s))`);
    for (const f of findings) {
      console.log(`  ✗ [${f.kind}] ${f.name}@${f.spec} — ${f.detail}`);
    }
  }

  process.exitCode = pass ? 0 : 1;
}

main();

#!/usr/bin/env node
// Supply-chain pin & slopsquat check (the real "Hallucinated-dependency / slopsquatting
// check" job — a custom 🟦 required CI job, NOT a native GitHub primitive).
//
// POLYGLOT (harness-bridge, 2026-06-30): this gate now supports two ecosystems via a real
// gate+schema edit (not a folder-add): `--ecosystem node|python` (auto-detected from the
// manifest filename when omitted). The Node path is unchanged; the Python path applies
// PyPI/PEP-508 pinning semantics + a PyPI typosquat list.
//
// Deterministic, offline checks over a dependency manifest. The HONEST definition of "pinned":
//   - NODE: a caret/tilde range IS acceptable WHEN a committed lockfile resolves it to an
//           exact, integrity-hashed version (the standard secure npm pattern). Bare ranges
//           with no lockfile, or floating specs, are flagged.
//   - PYTHON: an `==exact` pin is reproducible on its own (no lockfile required). Open ranges
//           (`>=X` with no upper bound, `*`, or no specifier) are mutable; bounded ranges
//           (`~=`, `^`, compound `>=,<`) are acceptable WHEN a lockfile covers them.
// In both ecosystems we flag the genuinely dangerous things:
//   1. SLOPSQUAT  — a name that is a likely typo/hallucination of a well-known package
//                   (Levenshtein distance 1 from the allowlist) or on a known-slop denylist.
//   2. MUTABLE    — a truly floating/mutable spec or a non-registry source (git/url/file).
//   3. NO-LOCKFILE/UNPINNED — a range with no lockfile to pin it (Node always needs one;
//                   Python only for non-exact specs).
//   4. UNLOCKED   — a ranged dependency absent from the committed lockfile.
//
// Exit 1 if any finding (gate is RED).
//
// Usage:
//   node pin-check.mjs --package <package.json> [--json]                 # Node (default)
//   node pin-check.mjs --ecosystem python --manifest <pyproject.toml|requirements.txt> [--json]

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

// ─────────────────────────────────────────────────────────────────────────────
// Shared
// ─────────────────────────────────────────────────────────────────────────────

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

function slopReason(name, wellKnown, denylist) {
  if (denylist.includes(name)) return 'on known-slop denylist';
  if (wellKnown.includes(name)) return null;
  for (const known of wellKnown) {
    if (Math.abs(known.length - name.length) <= 1 && levenshtein(name, known) === 1) {
      return `looks like a typo of "${known}" (Levenshtein distance 1)`;
    }
  }
  return null;
}

function parseArgs(argv) {
  const args = { json: false };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--json') args.json = true;
    else if (a === '--package') args.package = argv[++i];
    else if (a === '--manifest') args.manifest = argv[++i];
    else if (a === '--ecosystem') args.ecosystem = argv[++i];
  }
  // Infer ecosystem from the manifest filename when not explicit.
  if (!args.ecosystem) {
    const m = args.manifest || args.package || '';
    args.ecosystem = /(pyproject\.toml|requirements[^/\\]*\.txt|\.toml)$/i.test(m) ? 'python' : 'node';
  }
  if (args.ecosystem === 'node' && !args.package) {
    args.package = resolve(HERE, '..', '..', 'sample-app', 'package.json');
  }
  if (args.ecosystem === 'python' && !args.manifest) args.manifest = args.package;
  return args;
}

function emit(report, json) {
  if (json) {
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  } else {
    const where = report.manifest || report.package;
    console.log(
      `pin-check[${report.ecosystem}]: ${report.pass ? 'PASS ✅' : 'FAIL ❌'}  ` +
      `(${report.dependencyCount} deps, lockfile=${report.lockfile ? 'yes' : 'NO'}, ${report.findings.length} finding(s)) ${where}`,
    );
    for (const f of report.findings) console.log(`  ✗ [${f.kind}] ${f.name}@${f.spec} — ${f.detail}`);
  }
  process.exitCode = report.pass ? 0 : 1;
}

// ─────────────────────────────────────────────────────────────────────────────
// Node
// ─────────────────────────────────────────────────────────────────────────────

const NODE_WELL_KNOWN = [
  'express', 'lodash', 'react', 'react-dom', 'vue', 'next', 'axios', 'chalk',
  'commander', 'dotenv', 'zod', 'vitest', 'jest', 'supertest', 'typescript',
  'eslint', 'prettier', 'nodemon', 'ts-node', 'tsx', 'undici', 'fastify',
  'mongoose', 'pg', 'redis', 'cors', 'helmet', 'morgan', 'uuid', 'dayjs',
  'rate-limiter-flexible', 'express-rate-limit',
];

const NODE_DENYLIST = ['node-fetch-real', 'express-helper-utils', 'left-pad-secure'];

// 'exact' | 'range' (caret/tilde — OK if locked) | 'mutable' | 'source'
function classifySpecNode(spec) {
  if (typeof spec !== 'string') return 'mutable';
  const s = spec.trim();
  if (/^(git|github:|gitlab:|bitbucket:|file:|link:|workspace:|http:|https:|npm:)/i.test(s)) return 'source';
  if (/^\d+\.\d+\.\d+([-+][0-9A-Za-z.-]+)?$/.test(s)) return 'exact';
  if (/^[\^~]\d+\.\d+\.\d+([-+][0-9A-Za-z.-]+)?$/.test(s)) return 'range';
  return 'mutable'; // *, x, latest, >=, <, ||, hyphen ranges, empty, etc.
}

function findLockfileNode(pkgPath) {
  const dir = dirname(resolve(pkgPath));
  for (const name of ['package-lock.json', 'npm-shrinkwrap.json']) {
    const p = join(dir, name);
    if (existsSync(p)) return p;
  }
  return null;
}

function lockedNamesNode(lockPath) {
  const names = new Set();
  try {
    const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
    for (const key of Object.keys(lock.packages ?? {})) {
      if (!key) continue;
      const idx = key.lastIndexOf('node_modules/');
      if (idx === -1) continue;
      names.add(key.slice(idx + 'node_modules/'.length));
    }
    for (const name of Object.keys(lock.dependencies ?? {})) names.add(name);
  } catch {
    /* ignore parse errors; treated as no coverage */
  }
  return names;
}

function runNode(args) {
  const pkg = JSON.parse(readFileSync(resolve(args.package), 'utf8'));
  const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };

  const lockPath = findLockfileNode(args.package);
  const locked = lockPath ? lockedNamesNode(lockPath) : new Set();

  const findings = [];
  if (!lockPath && Object.keys(deps).length > 0) {
    findings.push({ name: '(repo)', spec: '-', kind: 'no-lockfile', detail: 'no package-lock.json / npm-shrinkwrap.json committed — ranges are not reproducibly pinned' });
  }

  for (const [name, spec] of Object.entries(deps)) {
    const slop = slopReason(name, NODE_WELL_KNOWN, NODE_DENYLIST);
    if (slop) findings.push({ name, spec, kind: 'slopsquat', detail: slop });

    const cls = classifySpecNode(spec);
    if (cls === 'mutable' || cls === 'source') {
      findings.push({ name, spec, kind: 'mutable', detail: `spec "${spec}" is mutable/non-registry — bypasses reproducible pinning` });
    } else if (cls === 'range' && lockPath && !locked.has(name)) {
      findings.push({ name, spec, kind: 'unlocked', detail: `range "${spec}" is not resolved in the committed lockfile` });
    } else if (cls === 'range' && !lockPath) {
      findings.push({ name, spec, kind: 'unpinned', detail: `range "${spec}" with no lockfile to pin it` });
    }
  }

  return {
    check: 'supply-chain pin & slopsquat',
    ecosystem: 'node',
    enforcement: 'required CI job — 🟦 custom logic (not a native GitHub primitive)',
    package: args.package,
    lockfile: lockPath,
    dependencyCount: Object.keys(deps).length,
    findings,
    pass: findings.length === 0,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Python (PyPI / PEP 508 / PEP 621 / requirements.txt / poetry)
// ─────────────────────────────────────────────────────────────────────────────

const PY_WELL_KNOWN = [
  'requests', 'urllib3', 'idna', 'certifi', 'charset-normalizer', 'numpy', 'pandas',
  'scipy', 'scikit-learn', 'matplotlib', 'pillow', 'flask', 'django', 'fastapi',
  'starlette', 'uvicorn', 'pydantic', 'pydantic-core', 'pydantic-settings', 'sqlalchemy',
  'jinja2', 'werkzeug', 'click', 'rich', 'typer', 'colorama', 'pyyaml', 'httpx', 'httpcore',
  'aiohttp', 'anyio', 'sniffio', 'openai', 'openai-agents', 'anthropic', 'boto3', 'botocore',
  'azure-identity', 'azure-core', 'azure-ai-projects', 'azure-ai-agentserver-responses',
  'azure-ai-agentserver-core', 'cryptography', 'cffi', 'pytest', 'pytest-asyncio',
  'python-dotenv', 'setuptools', 'wheel', 'pip', 'mcp', 'tqdm', 'packaging', 'attrs',
];

// Known PyPI hallucination/typosquat patterns (not all Levenshtein-1).
const PY_DENYLIST = ['python-requests', 'sklearn-utils', 'beautifulsupe', 'djanga', 'crypto'];

// 'exact' | 'range' (bounded — OK if locked) | 'mutable' | 'source'
function classifySpecPython(spec) {
  const s = (spec ?? '').trim();
  if (s === '') return 'mutable'; // no specifier → floats to latest
  if (/^@/.test(s) || /(^|\s)(git\+|https?:|file:)/i.test(s)) return 'source';
  if (/^===?\s*\d/.test(s)) return 'exact'; // == or === pin
  if (/^~=\s*\d/.test(s) || /^\^\s*\d/.test(s)) return 'range'; // compatible-release / poetry caret (bounded)
  if (/[<>]=?/.test(s)) {
    const hasLower = /(>=?)\s*\d/.test(s);
    const hasUpper = /(<=?)\s*\d/.test(s);
    return hasLower && hasUpper ? 'range' : 'mutable'; // bounded range vs open-ended (e.g. ">=2")
  }
  return 'mutable'; // *, latest, arbitrary
}

// Normalize a PyPI project name per PEP 503.
function normalizePyName(name) {
  return name.toLowerCase().replace(/[-_.]+/g, '-');
}

// Split a PEP 508 requirement string into { name, spec }.
function parsePep508(req) {
  let s = req.trim();
  if (!s) return null;
  // direct reference: "name @ url"
  const at = s.indexOf(' @ ');
  if (at !== -1) {
    return { name: normalizePyName(s.slice(0, at).replace(/\[.*\]$/, '').trim()), spec: '@' + s.slice(at + 3).trim() };
  }
  s = s.split(';')[0].trim(); // drop env marker
  const m = s.match(/^([A-Za-z0-9][A-Za-z0-9._-]*)\s*(\[[^\]]*\])?\s*(.*)$/);
  if (!m) return null;
  return { name: normalizePyName(m[1]), spec: (m[3] || '').trim() };
}

// Extract requirement strings from a pyproject.toml (PEP 621 arrays + poetry tables).
function extractFromPyproject(text) {
  const reqs = [];
  const lines = text.split(/\r?\n/);
  let section = '';
  let inArray = false;
  for (const raw of lines) {
    const line = raw.replace(/\s+#.*$/, '').replace(/^#.*$/, ''); // strip TOML comments
    const t = line.trim();
    if (!inArray && /^\[[^\]]+\]/.test(t)) {
      section = (t.match(/^\[([^\]]+)\]/) || [])[1] || '';
      continue;
    }
    const startProject = section === 'project' && /^dependencies\s*=\s*\[/.test(t);
    const startOptional = section === 'project.optional-dependencies' && /^[A-Za-z0-9_.-]+\s*=\s*\[/.test(t);
    if (!inArray && (startProject || startOptional)) {
      inArray = true;
      for (const mm of t.matchAll(/["']([^"']+)["']/g)) reqs.push(mm[1]);
      if (t.includes(']')) inArray = false;
      continue;
    }
    if (inArray) {
      for (const mm of t.matchAll(/["']([^"']+)["']/g)) reqs.push(mm[1]);
      if (t.includes(']')) inArray = false;
      continue;
    }
    // poetry table: [tool.poetry.dependencies] / [tool.poetry.group.<g>.dependencies]
    if (/^tool\.poetry(\.group\.[^.]+)?\.dependencies$/.test(section)) {
      const pm = t.match(/^([A-Za-z0-9._-]+)\s*=\s*(.+)$/);
      if (pm && pm[1].toLowerCase() !== 'python') {
        const rhs = pm[2].trim();
        let ver = '';
        if (/^["']/.test(rhs)) ver = rhs.replace(/^["']|["']$/g, '');
        else {
          const vm = rhs.match(/version\s*=\s*["']([^"']+)["']/);
          ver = vm ? vm[1] : '*';
        }
        reqs.push(`${pm[1]}${ver && !/^[@=~^<>*]/.test(ver) ? '==' + ver : ver}`);
      }
    }
  }
  return reqs;
}

// Extract requirement strings from a requirements.txt.
function extractFromRequirements(text) {
  const reqs = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\s+#.*$/, '').trim();
    if (!line || line.startsWith('#')) continue;
    if (/^-/.test(line)) continue; // -r, -e, --hash options handled separately
    reqs.push(line.split(/\s+--hash/)[0].trim());
  }
  return reqs;
}

function findLockfilePython(manifestPath) {
  const dir = dirname(resolve(manifestPath));
  for (const name of ['poetry.lock', 'uv.lock', 'pdm.lock', 'Pipfile.lock', 'requirements.lock']) {
    const p = join(dir, name);
    if (existsSync(p)) return p;
  }
  return null;
}

function runPython(args) {
  const manifestPath = resolve(args.manifest);
  const text = readFileSync(manifestPath, 'utf8');
  const isPyproject = /pyproject\.toml$/i.test(basename(manifestPath));
  const reqStrings = isPyproject ? extractFromPyproject(text) : extractFromRequirements(text);

  const deps = [];
  for (const r of reqStrings) {
    const parsed = parsePep508(r);
    if (parsed && parsed.name) deps.push(parsed);
  }

  const lockPath = findLockfilePython(manifestPath);
  // We do not parse the python lockfile contents here (formats vary); presence alone lets
  // bounded ranges pass. Exact pins never need it.

  const findings = [];
  for (const { name, spec } of deps) {
    const slop = slopReason(name, PY_WELL_KNOWN, PY_DENYLIST);
    if (slop) findings.push({ name, spec: spec || '(none)', kind: 'slopsquat', detail: slop });

    const cls = classifySpecPython(spec);
    if (cls === 'mutable' || cls === 'source') {
      findings.push({ name, spec: spec || '(none)', kind: 'mutable', detail: `spec "${spec || '(none)'}" is mutable/non-registry — bypasses reproducible pinning` });
    } else if (cls === 'range' && !lockPath) {
      findings.push({ name, spec, kind: 'unpinned', detail: `bounded range "${spec}" with no lockfile (poetry.lock/uv.lock/…) to pin it` });
    }
    // exact '==' → reproducible on its own; no finding, no lockfile required.
  }

  return {
    check: 'supply-chain pin & slopsquat',
    ecosystem: 'python',
    enforcement: 'required CI job — 🟦 custom logic (not a native GitHub primitive)',
    manifest: args.manifest,
    lockfile: lockPath,
    dependencyCount: deps.length,
    findings,
    pass: findings.length === 0,
  };
}

// ─────────────────────────────────────────────────────────────────────────────

function main() {
  const args = parseArgs(process.argv);
  const report = args.ecosystem === 'python' ? runPython(args) : runNode(args);
  emit(report, args.json);
}

main();

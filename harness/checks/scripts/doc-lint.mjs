#!/usr/bin/env node
// harness/checks/scripts/doc-lint.mjs — advisory (🟨) doc-vs-code drift check (SME consortium B6).
// Counts fixtures + scenarios on disk and checks the headline numbers appear in the docs. Folded
// under code-review (not a 9th agent). Exits 0 (advisory); --strict makes it fail. Never blocks CI.
import { readdirSync, statSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const walk = (d) => existsSync(d) ? readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? walk(p) : [p]; }) : [];
const fixtures = walk(join(ROOT, 'scenarios')).filter((p) => p.includes('fixtures') && p.endsWith('.json')).filter((p) => { try { const j = JSON.parse(readFileSync(p, 'utf8')); return j && j.agent && j.expect; } catch { return false; } });
const scenarios = readdirSync(join(ROOT, 'scenarios')).filter((n) => statSync(join(ROOT, 'scenarios', n)).isDirectory());
const N = fixtures.length, S = scenarios.length;
const docs = ['README.md', 'HARNESS_TESTING.md', '../AGENT.md'].map((f) => join(ROOT, f));
const drift = [];
for (const d of docs) { if (!existsSync(d)) continue; const t = readFileSync(d, 'utf8'); if (!t.includes(String(N))) drift.push(`${d}: missing fixture count ${N}`); }
const report = { check: 'doc-lint', enforcement: 'advisory 🟨', fixtures: N, scenarios: S, drift, pass: drift.length === 0 };
console.log(JSON.stringify(report, null, 2));
process.exitCode = (process.argv.includes('--strict') && drift.length) ? 1 : 0;

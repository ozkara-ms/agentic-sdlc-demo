#!/usr/bin/env node
// Deterministic output-rubric eval — the OUTPUT-RUBRIC half of the "evals" gate (a LAYERED
// PATTERN run as an Actions job / local assertion — NOT a native GitHub product).
//
// SCENARIO-GENERAL (Loop 2): this runner owns NO scenario knowledge. It boots the sample
// app (optionally mounting a candidate middleware variant via the `createApp({ extraMiddleware })`
// factory), then delegates ALL scoring to a pluggable RUBRIC MODULE that declares the probes
// to send and the failed-check → signal mapping. The rubric is chosen with `--rubric`; with
// none, it defaults to the built-in rate-limit rubric (so existing CI callers keep working).
//
// A rubric module exports:
//   meta = { kind, defaults: { route, method, max }, env?: { ENV_NAME: 'max' | literal } }
//   async evaluate({ probe, args, env }) -> { rubric, checks, signals, observed, pass, detail? }
// where `probe(route, method, body)` issues one request and `signals` are the rubric's own
// failed-check markers (the validator trusts them verbatim).
//
// Usage:
//   node eval-rubric.mjs --app <dist/app.js> [--variant <middleware.mjs>] [--rubric <rubric.mjs>]
//                        [--max 3] [--route /healthz] [--method GET] [--json]
//
// T1 (local validator): mount a fixture variant onto the unchanged app to simulate good/bad
//   implementations, e.g. --variant scenarios/<id>/variants/good.mjs --rubric scenarios/<id>/rubric.mjs
// T2 (real PR in the dedicated repo): omit --variant; the app already wires its own change, so
//   the rubric grades the actual PR implementation.

import { pathToFileURL } from 'node:url';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_RUBRIC = resolve(HERE, 'rubrics', 'rate-limit.mjs');

// Single request over a fresh, non-pooled socket. Using node:http with `agent: false`
// (instead of global fetch/undici) avoids keep-alive sockets that race process teardown
// on Windows and abort with a libuv assertion.
function request(port, route, method, body) {
  return new Promise((res, rej) => {
    const data = body ? JSON.stringify(body) : null;
    const headers = data
      ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) }
      : {};
    const req = http.request(
      { host: '127.0.0.1', port, path: route, method, agent: false, headers },
      (response) => {
        const chunks = [];
        response.on('data', (c) => chunks.push(c));
        response.on('end', () =>
          res({
            status: response.statusCode,
            retryAfter: response.headers['retry-after'] ?? null,
            headers: response.headers,
            body: Buffer.concat(chunks).toString('utf8'),
          }),
        );
        response.on('error', rej);
      },
    );
    req.on('error', rej);
    if (data) req.write(data);
    req.end();
  });
}

function parseArgs(argv) {
  const args = { max: null, route: null, method: null, json: false, variant: null, rubric: null };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--json') args.json = true;
    else if (a === '--app') args.app = argv[++i];
    else if (a === '--variant') args.variant = argv[++i];
    else if (a === '--rubric') args.rubric = argv[++i];
    else if (a === '--max') args.max = Number(argv[++i]);
    else if (a === '--route') args.route = argv[++i];
    else if (a === '--method') args.method = argv[++i];
  }
  // Default app path: ../../sample-app/dist/app.js relative to this script.
  if (!args.app) args.app = resolve(HERE, '..', '..', 'sample-app', 'dist', 'app.js');
  return args;
}

async function importDefault(path) {
  const mod = await import(pathToFileURL(resolve(path)).href);
  return mod.default ?? mod.createApp ?? mod;
}

async function main() {
  const args = parseArgs(process.argv);

  // Load the rubric module (scenario-declared, or the built-in rate-limit default).
  const rubricPath = args.rubric ? resolve(args.rubric) : DEFAULT_RUBRIC;
  const rubricMod = await import(pathToFileURL(rubricPath).href);
  if (typeof rubricMod.evaluate !== 'function') {
    throw new Error(`Rubric ${rubricPath} must export an async evaluate({ probe, args }).`);
  }
  const meta = rubricMod.meta ?? {};
  const defaults = meta.defaults ?? {};

  // Merge rubric defaults for anything not explicitly passed.
  if (args.max == null) args.max = defaults.max ?? 3;
  if (args.route == null) args.route = defaults.route ?? '/healthz';
  if (args.method == null) args.method = defaults.method ?? 'GET';

  // Export the env the rubric declares (e.g. RATE_LIMIT_MAX) so variants can read it.
  for (const [envName, source] of Object.entries(meta.env ?? {})) {
    const value = source === 'max' ? String(args.max) : String(source);
    if (process.env[envName] == null) process.env[envName] = value;
  }

  const appMod = await import(pathToFileURL(resolve(args.app)).href);
  const createApp = appMod.createApp ?? appMod.default;
  if (typeof createApp !== 'function') {
    throw new Error(`Could not load createApp() from ${args.app}. Build the sample app first (npm run build).`);
  }

  const extraMiddleware = [];
  if (args.variant) {
    const mw = await importDefault(args.variant);
    if (typeof mw !== 'function') {
      throw new Error(`Variant ${args.variant} must default-export an Express RequestHandler.`);
    }
    extraMiddleware.push(mw);
  }

  const app = createApp({ extraMiddleware });
  const server = await new Promise((res) => {
    const s = app.listen(0, '127.0.0.1', () => res(s));
  });
  const { port } = server.address();
  const probe = (route, method, body) => request(port, route, method, body);

  let report;
  try {
    report = await rubricMod.evaluate({ probe, args, env: process.env, port });
  } finally {
    await new Promise((res) => server.close(res));
  }

  const checks = report.checks ?? {};
  const checkNames = Object.keys(checks);
  const scoreN = Object.values(checks).filter(Boolean).length;
  const pass = report.pass ?? (checkNames.length > 0 && scoreN === checkNames.length);
  const signals = report.signals ?? [];

  const out = {
    rubric: report.rubric ?? meta.kind ?? 'output-rubric',
    enforcement: 'required CI job (T2) / local assertion (T1) — 🟦 layered eval, not a native gate',
    app: args.app,
    variant: args.variant,
    max: args.max,
    route: args.route,
    method: args.method,
    observed: report.observed ?? [],
    checks,
    signals,
    score: `${scoreN}/${checkNames.length}`,
    pass,
    detail: report.detail ?? null,
  };

  if (args.json) {
    process.stdout.write(JSON.stringify(out, null, 2) + '\n');
  } else {
    console.log(`eval-rubric: ${pass ? 'PASS ✅' : 'FAIL ❌'}  (${out.score})  rubric=${out.rubric}  variant=${args.variant ?? '(none / app as-is)'}`);
    for (const [k, v] of Object.entries(checks)) {
      console.log(`  ${v ? '✓' : '✗'} ${k}`);
    }
    if (!pass) {
      if (signals.length) console.log(`  signals: ${signals.join(', ')}`);
      if (out.observed.length) console.log(`  statuses: ${out.observed.map((o) => o.status).join(', ')}`);
    }
  }

  process.exitCode = pass ? 0 : 1;
}

main().catch((err) => {
  console.error(`eval-rubric: ERROR ${err.message}`);
  process.exitCode = 2;
});

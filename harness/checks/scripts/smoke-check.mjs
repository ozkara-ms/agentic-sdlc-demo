#!/usr/bin/env node
// Smoke-check — the deterministic go/no-go behind the Deployment gate.
//
// Boots the sample app (optionally with a fault-injecting variant), probes a liveness
// route, and decides go / no-go. On no-go it reports `rollback: true` — the signal the
// Deployment NEGATIVE fixture (failing-smoke build) must trip.
//
// Enforcement: 🟦 local harness assertion (T1) / 🟩 Environment reviewer + deployment
// history (T2). In T1 this proves the rollback LOGIC fires; T2 proves the platform blocks.
//
// Uses node:http with `agent: false` + process.exitCode (no global fetch/undici) to avoid
// the Windows keep-alive socket teardown crash — same pattern as eval-rubric.mjs.
//
// Usage:
//   node smoke-check.mjs --app <dist/app.js> [--variant <break-healthz.mjs>] [--route /healthz] [--expect 200] [--json]
//   node smoke-check.mjs --url <https://host/healthz> [--expect 200] [--retries 10] [--delay 3000] [--json]   # live ingress (T2)

import { pathToFileURL } from 'node:url';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import https from 'node:https';

const HERE = dirname(fileURLToPath(import.meta.url));

function request(port, route) {
  return new Promise((res, rej) => {
    const req = http.request(
      { host: '127.0.0.1', port, path: route, method: 'GET', agent: false },
      (response) => {
        response.resume();
        response.on('end', () => res({ status: response.statusCode }));
        response.on('error', rej);
      },
    );
    req.on('error', rej);
    req.end();
  });
}

// Remote liveness probe against a LIVE ingress URL (T2 — Azure Container Apps).
// Used by deploy.yml after `az containerapp update` to decide go / no-go on the real
// deployment. Retries with a fixed backoff because ACA can scale to zero (cold start).
function probeUrl(urlString, timeoutMs = 10000) {
  return new Promise((res, rej) => {
    let u;
    try {
      u = new URL(urlString);
    } catch {
      rej(new Error(`invalid --url: ${urlString}`));
      return;
    }
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.request(
      {
        method: 'GET',
        hostname: u.hostname,
        port: u.port || (u.protocol === 'https:' ? 443 : 80),
        path: (u.pathname || '/') + (u.search || ''),
        agent: false,
        timeout: timeoutMs,
      },
      (response) => {
        response.resume();
        response.on('end', () => res({ status: response.statusCode }));
        response.on('error', rej);
      },
    );
    req.on('timeout', () => req.destroy(new Error('probe timeout')));
    req.on('error', rej);
    req.end();
  });
}

async function remoteSmoke(args) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let observed = { status: 0 };
  let lastError = null;
  let attempts = 0;

  for (let i = 1; i <= args.retries; i += 1) {
    attempts = i;
    try {
      observed = await probeUrl(args.url);
      lastError = null;
      if (observed.status === args.expect) break;
    } catch (err) {
      lastError = err;
      observed = { status: 0 };
    }
    if (i < args.retries) await sleep(args.delayMs);
  }

  const smokePass = observed.status === args.expect;
  const report = {
    check: 'smoke',
    mode: 'remote',
    enforcement: 'CI live-smoke + revision rollback (🟦) / Environment reviewer + deployment record (🟩) / Azure external dep (⛔)',
    url: args.url,
    expect: args.expect,
    observedStatus: observed.status,
    attempts,
    decision: smokePass ? 'go' : 'no-go',
    rollback: !smokePass,
    signals: smokePass ? [] : ['rollback', 'no-go'],
    pass: smokePass,
    lastError: lastError ? lastError.message : null,
  };

  if (args.json) {
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  } else {
    console.log(
      `smoke-check[remote]: ${smokePass ? 'GO ✅' : 'NO-GO ❌ (rollback)'}  ${args.url} → ${observed.status} (expected ${args.expect}) after ${attempts} attempt(s)${lastError ? ` — last error: ${lastError.message}` : ''}`,
    );
  }
  process.exitCode = smokePass ? 0 : 1;
}

function parseArgs(argv) {
  const args = { route: '/healthz', expect: 200, json: false, variant: null, url: null, retries: 10, delayMs: 3000 };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--json') args.json = true;
    else if (a === '--app') args.app = argv[++i];
    else if (a === '--variant') args.variant = argv[++i];
    else if (a === '--route') args.route = argv[++i];
    else if (a === '--expect') args.expect = Number(argv[++i]);
    else if (a === '--url') args.url = argv[++i];
    else if (a === '--retries') args.retries = Number(argv[++i]);
    else if (a === '--delay') args.delayMs = Number(argv[++i]);
    else if (a === '--input') args.input = argv[++i];
  }
  if (!args.app) args.app = resolve(HERE, '..', '..', 'sample-app', 'dist', 'app.js');
  return args;
}

async function importDefault(path) {
  const mod = await import(pathToFileURL(resolve(path)).href);
  return mod.default ?? mod;
}

async function main() {
  const args = parseArgs(process.argv);

  // Remote mode — probe a LIVE ingress URL (T2). Skips the in-process app boot entirely.
  if (args.url) {
    await remoteSmoke(args);
    return;
  }

  // A fixture may carry its variant/route in an `input` block (validator convention).
  if (args.input) {
    const { readFileSync } = await import('node:fs');
    const f = JSON.parse(readFileSync(resolve(args.input), 'utf8'));
    const inp = f.input ?? f;
    if (inp.variant) args.variant = resolve(dirname(resolve(args.input)), inp.variant);
    if (inp.route) args.route = inp.route;
    if (inp.expect != null) args.expect = Number(inp.expect);
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

  let observed;
  try {
    observed = await request(port, args.route);
  } finally {
    await new Promise((res) => server.close(res));
  }

  const smokePass = observed.status === args.expect;
  const decision = smokePass ? 'go' : 'no-go';
  const report = {
    check: 'smoke',
    enforcement: 'local harness (T1) / Environment reviewer + deployment history (T2) — 🟦/🟩',
    app: args.app,
    variant: args.variant,
    route: args.route,
    expect: args.expect,
    observedStatus: observed.status,
    decision,
    rollback: !smokePass,
    signals: smokePass ? [] : ['rollback', 'no-go'],
    pass: smokePass,
  };

  if (args.json) {
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  } else {
    console.log(`smoke-check: ${smokePass ? 'GO ✅' : 'NO-GO ❌ (rollback)'}  ${args.route} → ${observed.status} (expected ${args.expect})`);
  }

  process.exitCode = smokePass ? 0 : 1;
}

main().catch((err) => {
  console.error(`smoke-check: ERROR ${err.message}`);
  process.exitCode = 2;
});

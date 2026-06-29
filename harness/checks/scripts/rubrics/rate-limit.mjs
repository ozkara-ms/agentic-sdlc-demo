// Rubric: rate-limit-output (scenario S1).
//
// The S1 acceptance ORACLE, extracted out of eval-rubric.mjs so the runner itself owns
// NO scenario knowledge. A rubric module exports:
//   - meta: { kind, defaults }      → declares the probe shape + its env/threshold defaults
//   - evaluate({ probe, args }) → { rubric, checks, signals, observed, pass, detail }
//
// `signals` is the rubric's OWN failed-check → marker mapping. The validator trusts it
// verbatim, so adding a new scenario never edits the validator or the runner.
//
// Scores a burst of requests against three objective checks:
//   1. limiting_present   — a 429 appears once the allowance is exhausted   (else → "no-429")
//   2. threshold_correct  — the FIRST 429 lands exactly at request (max+1)  (else → "wrong-threshold")
//   3. retry_after_present— every 429 carries a parseable numeric Retry-After(else → "missing-retry-after")

export const meta = {
  kind: 'burst-threshold',
  // The runner merges these when --max/--route/--method are not passed, and also exports
  // RATE_LIMIT_MAX / RATE_LIMIT_WINDOW_MS into the env so the limiter variant can read them.
  defaults: { route: '/healthz', method: 'GET', max: 3 },
  env: { RATE_LIMIT_MAX: 'max', RATE_LIMIT_WINDOW_MS: '60000' },
};

export async function evaluate({ probe, args }) {
  const max = args.max;
  const route = args.route;
  const method = args.method;

  const burst = max + 2; // enough to cross the threshold and confirm it sticks
  const observed = [];
  for (let i = 0; i < burst; i += 1) {
    const body = method === 'POST' ? { url: 'https://example.com' } : null;
    const r = await probe(route, method, body);
    observed.push({ index: i + 1, status: r.status, retryAfter: r.retryAfter });
  }

  const limited = observed.filter((o) => o.status === 429);
  const firstLimited = observed.find((o) => o.status === 429)?.index ?? null;
  const retryAfterOk = limited.length > 0 && limited.every((o) => {
    const n = Number(o.retryAfter);
    return o.retryAfter != null && Number.isFinite(n) && n >= 0;
  });

  const checks = {
    limiting_present: limited.length > 0,
    threshold_correct: firstLimited === max + 1,
    retry_after_present: retryAfterOk,
  };

  const signals = [];
  if (!checks.limiting_present) signals.push('no-429');
  else if (!checks.threshold_correct) signals.push('wrong-threshold');
  if (!checks.retry_after_present) signals.push('missing-retry-after');

  return {
    rubric: 'rate-limit-output',
    checks,
    signals,
    observed,
    pass: Object.values(checks).every(Boolean),
    detail: { firstLimitedIndex: firstLimited, expectedFirst: max + 1 },
  };
}

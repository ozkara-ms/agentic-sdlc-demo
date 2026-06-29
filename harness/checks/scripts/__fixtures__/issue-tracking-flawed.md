# Tracking: Add rate limiting to the URL-shortener API  (FLAWED plan — Rubber-Duck must CATCH)

This is the injected-flaw variant. Two units that BOTH touch the shared limiter store are marked
parallel-safe (a hidden cross-unit dependency), and the integration test is mislabeled parallel-safe.
plan-lint must trip rules **B** (parallel-units-share-path) and **C** (integration-marked-parallel).

<!-- machine-readable plan consumed by ci/scripts/issue-to-plan.mjs -> plan-lint.mjs -->
```json agentic-plan
{
  "intent": "Add rate limiting to the URL-shortener API so a single client can't exhaust the service.",
  "units": [
    { "id": "U1", "title": "limiter middleware (writes the shared store)",
      "paths": ["src/middleware/rateLimit.ts", "src/store/limiterStore.ts"],
      "parallelSafe": true, "dependsOn": [] },
    { "id": "U2", "title": "config surface — ALSO writes the shared limiter store",
      "paths": ["src/config.ts", "src/store/limiterStore.ts"],
      "parallelSafe": true, "dependsOn": [] },
    { "id": "U3", "title": "docs — rate-limit section",
      "paths": ["README.md"], "parallelSafe": true, "dependsOn": [] },
    { "id": "U4", "title": "integration e2e test (drives past the limit; asserts 429 + Retry-After)",
      "paths": ["test/e2e/rateLimit.e2e.test.ts"], "parallelSafe": true, "dependsOn": [] }
  ]
}
```

# Tracking: Add rate limiting to the URL-shortener API

**Problem.** A single client can exhaust the URL-shortener. Add per-client rate limiting so that past a
configured threshold the API returns **429** with `Retry-After` + `RateLimit-*` headers, and stays **200**
under the threshold.

**Acceptance (real results, E2E).** Against the deployed URL: under the threshold → 200; past it → 429 with
a numeric `Retry-After` and `RateLimit-Limit`/`RateLimit-Remaining` headers.

## Work units & dependency graph
| Unit | Title | Parallel-safe | Depends on |
|------|-------|---------------|------------|
| U1 | limiter middleware | yes | — |
| U2 | config surface | yes | — |
| U3 | docs — rate-limit section | yes | — |
| U4 | integration/e2e test (drives past the limit; asserts 429 + Retry-After) | **no** | U1, U2 |

<!-- machine-readable plan consumed by ci/scripts/issue-to-plan.mjs -> plan-lint.mjs -->
```json agentic-plan
{
  "intent": "Add rate limiting to the URL-shortener API so a single client can't exhaust the service.",
  "units": [
    { "id": "U1", "title": "limiter middleware",
      "paths": ["src/middleware/rateLimit.ts"], "parallelSafe": true, "dependsOn": [],
      "requiredTest": "test/rateLimit.test.ts",
      "evals": ["rate-limit-429"], "evalRoute": "/api/links", "evalMax": 100, "evalMethod": "GET" },
    { "id": "U2", "title": "config surface (RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS)",
      "paths": ["src/config.ts"], "parallelSafe": true, "dependsOn": [] },
    { "id": "U3", "title": "docs — rate-limit section",
      "paths": ["README.md"], "parallelSafe": true, "dependsOn": [] },
    { "id": "U4", "title": "integration test (drives past the limit; asserts 429 + Retry-After)",
      "paths": ["test/e2e/rateLimit.e2e.test.ts"], "parallelSafe": false, "dependsOn": ["U1", "U2"] }
  ]
}
```

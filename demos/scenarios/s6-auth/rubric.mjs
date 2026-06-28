// S6 acceptance ORACLE — API-key auth, a 401 contract (deliberately NOT 429 and NOT 400).
// Reuses the scenario-general request-contract oracle: proves the eval handles a third status
// family with ZERO runner/validator changes.
import { makeRequestContractRubric } from '../../ci/scripts/rubrics/request-contract.mjs';

export const { meta, evaluate } = makeRequestContractRubric({
  kind: 'api-key-auth-contract',
  defaults: { route: '/shorten', method: 'POST' },
  cases: [
    {
      name: 'healthz-open', route: '/healthz', method: 'GET',
      asserts: [{ check: 'healthz_open', status: 200, signal: 'healthz-not-open' }],
    },
    {
      name: 'shorten-needs-key', route: '/shorten', method: 'POST', body: { url: 'https://example.com/x' },
      asserts: [
        { check: 'rejects_missing_key', status: 401, signal: 'missing-key-not-rejected' },
        { check: 'auth_error_is_json', status: 401, jsonKey: 'error', signal: 'auth-error-not-json' },
      ],
    },
  ],
});

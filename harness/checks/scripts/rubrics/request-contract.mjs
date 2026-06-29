// Reusable REQUEST-CONTRACT acceptance oracle (Loop 2, scenario-general).
//
// This is the SECOND oracle KIND (after rate-limit) and exists to prove the harness eval is
// truly scenario-declared: a scenario whose acceptance is an HTTP request/response contract
// (e.g. "POST malformed → 400 + JSON error; POST valid → 2xx") runs through the SAME
// eval-rubric runner with ZERO changes to the runner or validator.
//
// A scenario's rubric.mjs adopts it:
//   import { makeRequestContractRubric } from '../../ci/scripts/rubrics/request-contract.mjs';
//   export const { meta, evaluate } = makeRequestContractRubric({ kind, defaults, env, cases });
//
// Shapes:
//   case   = { name, route?, method?, body?, asserts: [ assert, ... ] }
//   assert = { check, signal, status?, jsonKey? }
//     - status:  response.status must equal this value
//     - jsonKey: the parsed JSON body must have this own-property
//     - an assert with neither status nor jsonKey is treated as trivially satisfied
// The rubric emits its OWN failed-assertion `signals` (the validator trusts them verbatim),
// so no scenario specifics leak into the runner.

export function makeRequestContractRubric({ kind = 'request-contract', defaults = {}, env = {}, cases = [] }) {
  async function evaluate({ probe }) {
    const checks = {};
    const signals = [];
    const observed = [];

    for (const c of cases) {
      const route = c.route ?? defaults.route ?? '/';
      const method = c.method ?? defaults.method ?? 'POST';
      const resp = await probe(route, method, c.body ?? null);

      let json = null;
      try {
        json = JSON.parse(resp.body);
      } catch {
        /* non-JSON body — jsonKey asserts will fail, which is the point for contract negatives */
      }

      observed.push({
        case: c.name,
        route,
        method,
        status: resp.status,
        jsonKeys: json && typeof json === 'object' ? Object.keys(json) : null,
        bodyPreview: typeof resp.body === 'string' ? resp.body.slice(0, 80) : null,
      });

      for (const a of c.asserts ?? []) {
        const statusOk = a.status == null || resp.status === a.status;
        const keyOk =
          a.jsonKey == null ||
          (json != null && typeof json === 'object' && Object.prototype.hasOwnProperty.call(json, a.jsonKey));
        const ok = statusOk && keyOk;
        checks[a.check] = ok;
        if (!ok && a.signal) signals.push(a.signal);
      }
    }

    const names = Object.keys(checks);
    const pass = names.length > 0 && names.every((n) => checks[n]);
    return { rubric: kind, checks, signals, observed, pass };
  }

  return { meta: { kind, defaults, env }, evaluate };
}

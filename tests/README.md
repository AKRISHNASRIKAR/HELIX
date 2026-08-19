# tests (root)

Most tests live next to the code they test (`apps/api/src/**/*.spec.ts`,
`apps/api/test/*.e2e-spec.ts`, `services/*/tests/*.py`, etc.) — see each
package's own test setup.

This top-level directory is for **cross-cutting** tests that don't belong to
one package:

- `e2e/` — full-stack scenarios that exercise `apps/web` + `apps/api` +
  Python services together (e.g. "create an investigation, verify it appears
  in the dashboard"). Empty until there's an actual investigation flow to
  test end-to-end (Phase 5+).
- `fixtures/` — shared seeded datasets used by both the evaluation dataset
  (`docs/research/evaluation.md`) and cross-cutting e2e tests, so a "revenue
  drop caused by a checkout deployment" scenario is defined once and reused.
  Empty until Phase 3+ (analytics needs real data to test against first).

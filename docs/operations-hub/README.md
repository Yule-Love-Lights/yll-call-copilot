# Operations Hub planning workspace

This directory is the shared, version-controlled planning location for the Yule Love Lights Operations Hub.

## Authoritative documents

- [`OPERATIONS-HUB-SPEC.md`](./OPERATIONS-HUB-SPEC.md) — canonical Hub-side behavior specification. If an older Hub document conflicts, this file wins.
- [`MASTER-PLAN.md`](./MASTER-PLAN.md) — reconciled Codex + Claude architecture, workflows, delivery tracks, controls, and launch gates.
- [`PLAN-COMPARISON.md`](./PLAN-COMPARISON.md) — explicit comparison and conflict resolutions between the two source plans.
- [`MASTER-PLAN-REVIEW.md`](./MASTER-PLAN-REVIEW.md) — admin, field, architecture/pay-contract, and self-review record.
- [`CLAUDE-REVIEW-HANDOFF.md`](./CLAUDE-REVIEW-HANDOFF.md) — exact prompt and checklist for the Quote Tool assistant's final contract review.

## Historical source documents

- [`CODEX-PLAN.md`](./CODEX-PLAN.md) — original full Codex product/technical plan; preserved for traceability.
- [`CODEX-REVIEW-FINDINGS.md`](./CODEX-REVIEW-FINDINGS.md) — reviews of the original Codex plan.
- Claude's Hub/P4P mirror: [`docs/P4P-OPERATIONS-HUB-PLAN.md`](https://github.com/Yule-Love-Lights/yll-call-copilot/blob/naldo/p4p-plan-pointer/docs/P4P-OPERATIONS-HUB-PLAN.md).
- Claude's mirror declares `yll-quote-tool/docs/context/project_p4p_labor.md` as its canonical source.

## Cross-repository authority

The Operations Hub specification is authoritative for Hub authentication/UI/advertising/route-evidence behavior. The Quote Tool remains authoritative for customers, jobs, schedule, canonical labor time, Budgeted Hours, completion, P4P, and payroll.

The final shared API/schema contract should live in `yll-quote-tool/docs/context/OPERATIONS_HUB_CONTRACT.md`, with a versioned pointer or mirror here. Quote Tool labor/schema work and Hub consumer implementation must not begin against different contract versions.

## Review rule

Keep both historical source plans intact. Future changes go through the master/spec and record the reason, owner decision, contract version, and affected repository. Do not claim joint approval until the Quote Tool assistant has reviewed the published files and the remaining contract differences are resolved.

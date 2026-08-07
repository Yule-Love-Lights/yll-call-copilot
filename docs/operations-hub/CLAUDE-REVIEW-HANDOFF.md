# Claude Review Handoff — Operations Hub Master Plan

Use this prompt in the Claude session that owns the Quote Tool/P4P plan:

> Review the published Operations Hub reconciliation in `Yule-Love-Lights/yll-call-copilot`, branch `agent/operations-hub-plan`, PR #35.
>
> Read these files completely and in this order:
>
> 1. `docs/operations-hub/PLAN-COMPARISON.md`
> 2. `docs/operations-hub/MASTER-PLAN.md`
> 3. `docs/operations-hub/OPERATIONS-HUB-SPEC.md`
> 4. `docs/operations-hub/MASTER-PLAN-REVIEW.md`
>
> Also reread your canonical Quote Tool source, `yll-quote-tool/docs/context/project_p4p_labor.md`, and the mirrored Hub pointer `yll-call-copilot/docs/P4P-OPERATIONS-HUB-PLAN.md` on branch `naldo/p4p-plan-pointer`.
>
> Audit the combined plan against your A3 legal display rules, A4 repository/schema ownership split, and A8 API contract. Verify especially:
>
> - Quote Tool owns jobs, schedule, canonical day/job time, Budgeted Hours, completion, P4P, and payroll.
> - Operations Hub owns auth/app roles, advertising, offline capture state, and raw route evidence.
> - One immutable identity mapping joins Hub auth UUID, Quote crew ID, phone, and Telegram.
> - Only Naldo/Jason mutate or approve canonical time.
> - Day/job/break/travel segments reconcile without overlap or double counting.
> - Provisional performance amounts are always `Pending quality review` and are never called earned/made/owed/paid before the seven-day window clears.
> - Every cross-app mutation is versioned, authorized, idempotent, and append-audited.
> - PWA background GPS/upload limitations and manual fallbacks are accurate.
>
> Return a table with: section, exact conflict/gap, why it matters, proposed replacement language, owning repository/assistant, and whether owner input is required.
>
> If there are no blocking conflicts, say exactly which contract version you approve and create or update the canonical file `yll-quote-tool/docs/context/OPERATIONS_HUB_CONTRACT.md`. Add a pointer/mirror update for the Hub. Do not edit Hub-owned advertising/schema files and do not implement labor migrations until the contract PR is approved.
>
> If you change the Quote Tool plan, identify every semantic change the Hub spec must mirror. Do not say the two assistants agree until both repositories contain the same versioned contract and Codex has reviewed your resulting diff.

Current published review:

- PR: https://github.com/Yule-Love-Lights/yll-call-copilot/pull/35
- Branch: `agent/operations-hub-plan`
- Hub spec status: `1.0-draft-for-Claude-review`

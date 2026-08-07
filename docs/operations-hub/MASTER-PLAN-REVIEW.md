# Master Plan Review Record

Date: 2026-08-06  
Reviewed inputs: Codex full Hub plan, Claude P4P/Operations plan, reconciliation draft, master draft.

## Review lenses

- Owner/admin operations review: permissions, approvals, reporting, rollout, external-tool retirement.
- Field review: office/advertising/installer daily flows, low-click camera, GPS/offline/PWA, corrections, accessibility.
- Architecture/pay-contract review: source of truth, migrations, identity, canonical time, API/idempotency, audit/security, and seven-day pay language.
- Primary-agent self-review: consistency with every recorded owner answer and removal of unsupported browser/pay claims.

## Blocking findings and resolutions

| Finding | Resolution in final plan/spec |
|---|---|
| Managers could approve time despite owner restriction | Only Jason/Naldo mutate/approve; managers comment/recommend. |
| Day/job/break/travel time could overlap or double count | Added one paid-day envelope and non-overlapping reconciliation state machine. |
| Hard schedule gate hid useful upcoming work | Added non-sensitive pre-clock summary and gated exact same-day details. |
| Placement Run became two taps and X confirmation | Campaign-specific one-tap Start; X immediate end + Undo. |
| Forgotten run had end time but no trigger | Local midnight trigger; last durable shutter timestamp; zero-photo review. |
| Offline run/number behavior ambiguous | New run online; confirmed run continues/ends offline; server-acceptance numbering. |
| Missing GPS could be attached after worker moved | Short same-camera/stationary grace with recorded time delta; otherwise unverified. |
| Upload wording implied closed-PWA background work | Upload while active, resume on reopen; disclose OS storage eviction limits. |
| Placement original/stamp/Undo/no-reuse missing | Restored all; server derivative includes time/address/accuracy/Sign Number. |
| Route auto-visit overpromised browser ability | Manual visits Phase 3; foreground suggestions Phase 5; never automatic payroll fact. |
| Call Copilot could be mistakenly retired | Preserve/rename YLL Call Copilot; external Copilot CRM/Homeworks has separate cancellation gate. |
| P4P confirmed rules diluted | Restored shadow, weekly/seven-day timing, hourly takedown, collection/final input, one-time travel, Sept. 21 target. |
| Provisional pay wording could leak | Server states + forbidden wording rule on every UI/report/bot/export. |
| Cross-repo migration collision | Quote assistant exclusively owns shared labor schema/API; contract merges before consumers. |
| Audit/security insufficient | Added active-user checks, atomic audit/outbox, service auth/replay/rotation, cache rules, fail-closed public routes, kill switches. |
| Storage/geospatial finalization unclear | Added SRID 4326/geography indexing and recoverable atomic upload-finalize/orphan states. |
| Telegram advertising start/end crossed ownership | V1 uses status/deep link only; run mutations stay Hub-owned. |
| Door-hanger residential privacy unresolved | Protective default: exact data Naldo/Jason-only; team view rounded/aggregated. Broader access feature-gated. |

## Self-review results

- No duplicate authoritative job, schedule, labor-time, completion, or pay ledger remains.
- Advertising Placement Runs are not described as payroll time.
- Every provisional-pay surface uses `Pending quality review`; only server-earned enters payroll export.
- PWA background tracking/upload is described as best effort and manual fallbacks are mandatory.
- Sign Number order is technically feasible and stable.
- Manager versus owner authority now matches the recorded decisions.
- Unique yard-sign analytics say `placement spot`, never `house`.
- Removal/retrieval claims were removed from V1.
- Remaining privacy/wage/surveillance decisions are protective-default or feature-gated, not silently invented.

## Residual blockers

These do not invalidate the plan; they block only their affected feature:

- Quote-side OpenAPI/schema contract has not yet been reviewed and mirrored by Claude.
- Exact installer completion-photo policy awaits owner decision.
- Exact P4P compensation/legal/payroll inputs await qualified approval.
- Door-hanger broader visibility, unique-spot clustering, and calibrated GPS/storage thresholds await field evidence/owner approval.

## Review conclusion

The final Hub-side plan is coherent and buildable as a staged program. It is ready for Claude/Quote Tool contract review, not yet evidence that Claude has approved it. No shared labor implementation should begin until both repository plans point to the same versioned cross-repository contract.

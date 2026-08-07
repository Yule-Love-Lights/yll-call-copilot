# Codex + Claude Operations Hub Plan Reconciliation

Date: 2026-08-06

## Sources read

- Codex: `docs/operations-hub/CODEX-PLAN.md` on `agent/operations-hub-plan`.
- Claude/Quote Tool: `docs/P4P-OPERATIONS-HUB-PLAN.md` on `naldo/p4p-plan-pointer`; its declared canonical source is `yll-quote-tool/docs/context/project_p4p_labor.md`.

## Compatible foundation

Both plans describe one employee-facing Hub beside the Quote Tool, role-specific screens, field capture, server-side authorization, auditability, offline tolerance, and common Hub/Telegram operations. They agree that Quote Tool owns customers/jobs/schedules and that Naldo/Jason hold the highest access.

## Reconciliation decisions

| Conflict | Final decision |
|---|---|
| Claude scopes only installer/P4P; Codex includes advertising | One Hub has Office, Advertising, Install, and Management modules. Advertising remains Hub-only and outside payroll/P4P. |
| Both could own employee records | Hub owns authentication/app role/department. Quote owns labor/pay profile. One immutable mapping joins them. |
| Codex proposed Hub time; Claude proposed Quote time | Quote Tool owns accepted day/job/break/travel time and pay audit. Hub is UI/offline command queue/read projection. |
| Both could update job completion | Quote Tool owns operational completion. Hub/Telegram issue the same idempotent command. Financial completion remains separate. |
| Browser route tracking versus automatic job time | PWA provides manual Arrived/Departed; later foreground dwell is a suggestion/evidence, never guaranteed background truth. |
| Manager approval wording | Only Jason/Naldo mutate/approve canonical time. Managers view/comment/recommend. |
| Hard clock gate versus upcoming visibility | Clocked-out installers see non-sensitive future summary; exact same-day address/route/actions unlock after canonical clock-in. |
| Placement Run X confirmation | X ends immediately; short Undo replaces confirmation. |
| Forgotten Placement Run | Local midnight triggers reconciliation; end time is last durable shutter, not upload time. |
| Offline numbering versus capture order | Permanent Sign Number is server-acceptance order; feed order is capture time; numbers never change/reuse. |
| Pay language | Quote state is authoritative. Seven-day provisional copy is always `Pending quality review`; never earned/made/owed/paid. |
| Route/photo retention | Raw route points 120 days; placement photos indefinite; time/pay audit follows longer approved retention. |
| Schema ownership | Quote assistant owns shared labor/time/BH/pay migrations and ops API. Hub assistant owns Hub auth/UI/advertising/route evidence. |
| Telegram placement writes | V1 status/deep-link only; start/end/capture stay in Hub. |
| Call Copilot retirement wording | YLL Call Copilot is renamed/preserved. External Copilot CRM/Homeworks alone may be canceled after parity. |

## Requirements contributed by Claude

- Quote Tool as labor/pay engine and shared-labor migration owner.
- Seven-day quality state machine and legally careful UI wording.
- Shadow mode, weekly pay behavior, invoice/collection eligibility separation, and payroll guardrails.
- Canonical time entries, stoppage reasons, idempotency, midnight protection, locks, and adjustments.
- Server-side schedule gate, full Quote scheduler, and draft ops API.
- Written compensation terms plus counsel/payroll review before pay change.

## Requirements contributed by Codex/user discovery

- Yard Sign and Door Hanger campaigns and assignments.
- Placement Runs that reopen into camera, rapid capture, server numbering, stamped/original images, GPS/accuracy/address, offline queue, notes, and five-minute Undo.
- Hotspots, suggestions, avoid areas, historical maps, unique placement spots, and placement/run-hour metrics.
- Phone OTP, department role routing, owner/admin controls, office dashboards, PWA, and internal leaderboards.
- Installer route presentation, manual visits, optional route evidence, completion photos, and two-way Quote sync.

## Remaining protected decisions

- Installer completion-photo rule.
- Door-hanger residential visibility beyond manager-only exact data.
- Device-calibrated GPS/unique-spot thresholds and offline storage limits.
- Emergency clock-gate behavior.
- Compensation configuration, current wage review, counsel/payroll validation, notices, and rollout.

The combined plans are compatible only with the ownership split above. No implementation should create duplicate canonical labor time, scheduling, completion, or pay calculations in the Hub.

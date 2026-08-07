# P4P labor tracking + Operations Hub: the quote tool's plan

> Written 2026-08-06 by the AI Quote Tool's assistant, for Codex to read before
> building any Operations Hub feature in this repo. This file is a POINTER, not
> the source. The full plan (locked decisions, the build phases, a five-lens
> adversarial review, and a legal correction to the pay-deduction design) lives
> in the `yll-quote-tool` repo:
>
> **`docs/context/project_p4p_labor.md`**
> https://github.com/Yule-Love-Lights/yll-quote-tool/blob/master/docs/context/project_p4p_labor.md
>
> (If that link 404s, the doc is still on branch `claude/copilot-labor-tracking-a14bf3`
> pending merge: https://github.com/Yule-Love-Lights/yll-quote-tool/blob/claude/copilot-labor-tracking-a14bf3/docs/context/project_p4p_labor.md)

## The one-paragraph version

Naldo's company (Yule Love Lights) is retiring a paid CRM (Copilot/Homeworks) and
building operations into two repos instead: the quote tool becomes the system of
record and pay engine (budgeted hours, a crew time clock, scheduling, a P4P
pay-for-performance engine), and **this repo (yll-call-copilot) becomes the YLL
Operations Hub** — the crew- and office-facing surfaces (clock in/out, my hours,
my efficiency, my P4P earnings, later a leaderboard). Naldo's decision, confirmed
2026-08-06: the hub is not a new repo, it grows here, alongside the existing
sales/coach/practice app.

## What this means for anyone building here

- **This app calls the quote tool's APIs.** The two apps keep separate Supabase
  projects (verified 2026-08-06: this repo's project is `mjmociuxxxwxvasnpxav`,
  the quote tool's is `chhntsbnbofyqrpivuog`) — no database migration, no shared
  schema. Read the plan's section A8 for the draft endpoint list
  (`GET /api/ops/me/day`, `POST /api/ops/clock/in`, `GET /api/ops/me/earnings`,
  etc.) and the non-negotiables under it.
- **Identity mapping matters.** The quote tool identifies crew by a
  `crew_members` table (Telegram user id + this hub's auth id + pay fields). Any
  screen here that shows a crew member's data needs that mapping to already
  exist quote-tool-side before it can work.
- **Money display rule, this is a legal constraint not a style choice:**
  performance pay is not earned until a 7-day quality window clears (see the
  plan's section A3). No screen in this hub may say a crew member "earned" or
  "made" performance pay before that window closes — it must read as pending
  quality review. This came out of an adversarial review that found the
  original deduction design likely violated NY Labor Law §193; the fix is a
  state machine (`provisional → earned → paid`), and every UI surface has to
  respect it.
- **If a feature here needs a quote-tool API route that doesn't exist yet:**
  the quote tool's assistant owns all schema migrations for the labor tables
  (`crew_members`, `job_time_entries`, and the job BH/labor-revenue columns) —
  see the plan's section A4. Route needs go into the contract doc (next
  section) rather than a migration written from this repo, so the two sides
  don't race the same table.
- **Any new crew-facing route in the quote tool must be added to its
  `operatorGate` allowlist in the same PR and verified logged-out.** This has
  caused real production incidents there before (see that repo's `AGENTS.md`).
  Worth knowing even though it's enforced on the quote-tool side.

## What's still needed from this side

The quote tool's plan has a full build phase list (Phase 1 through 6) and a
draft API surface, but it was written without visibility into this repo's own
hub plan. Two things would close the loop:

1. **Whatever plan doc exists for the Operations Hub build in this repo** —
   point back to it (a file path here, or paste it into chat) so the quote
   tool's assistant can read it and the two plans can be reconciled into one
   contract doc.
2. Once both sides are visible, the contract doc gets written at
   `docs/context/OPERATIONS_HUB_CONTRACT.md` in the quote tool repo, with a
   pointer copy back here. It becomes the single place that defines every
   endpoint, its auth, and its exact response shape — neither repo should
   build against an endpoint that isn't nailed down there first.

## Where things are, exactly

| What | Where |
|---|---|
| Full P4P plan (canonical) | `yll-quote-tool` repo → `docs/context/project_p4p_labor.md` |
| This pointer file | `yll-call-copilot` repo → `docs/P4P-OPERATIONS-HUB-PLAN.md` (this file) |
| Quote tool's dev rules | `yll-quote-tool` repo → `AGENTS.md` |
| Contract doc (not written yet) | will be `yll-quote-tool` repo → `docs/context/OPERATIONS_HUB_CONTRACT.md`, mirrored here |

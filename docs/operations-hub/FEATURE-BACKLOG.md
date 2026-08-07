# Operations Hub feature backlog (from the five-lens review, 2026-08-06)

> Candidate features surfaced by the persona review (advertising worker,
> installer, office/call-tool synergy, owner/manager, technical). Status:
> PICK = awaiting Naldo's greenlight; CONTRACT = already folded into
> OPERATIONS_HUB_CONTRACT v1.1.0 as a build requirement; OPEN = blocked on a
> decision recorded in DECISIONS.md. Sizes S/M/L. Track = who builds.

## Already folded into the contract (not optional anymore)

| Feature | Track |
|---|---|
| Design snapshot + derived load list + job-site notes endpoint | A |
| Takedown "hourly mode" badge on crew surfaces | A + C |
| `sold_by_employee_id` + "your sale is installed" rep notification + review/referral enqueue | A + C |
| Missed-tap same-day bot nudge | A |
| Material-actuals fields pinned on the complete command | A |
| DLQ Telegram alert, deploy version smoke, shared schema artifact | A + B/C |
| Deactivation final-pay checklist | A |
| Flow F attribution reserved (campaign short-codes at intake, ROI reads) | v1.2 |

## PICK list for Naldo (recommended cheap wins marked ✓)

| # | Feature | Lens | Size | Track | Rec |
|---|---|---|---|---|---|
| 1 | Sign-stock counter + restock request in Camera Mode | Advertising | S | B | ✓ |
| 2 | Campaign goal thermometer on the dashboard | Advertising | S | B | ✓ |
| 3 | Share-a-spot to a specific teammate | Advertising | S | B | |
| 4 | Per-town/zip coverage map | Advertising | M | B | |
| 5 | Assigned zones per Placement Run | Advertising | M | B | |
| 6 | Live "teammate active nearby" indicator | Advertising | M | B | |
| 7 | Best-time-of-day placement hints | Advertising | M | B | |
| 8 | Streaks/badges beyond the leaderboard | Advertising | S | B | |
| 9 | Next-job maps handoff on Depart | Installer | S | C | ✓ |
| 10 | On-site change-request quick capture (photo+note+flag) | Installer | S/M | C+A | ✓ |
| 11 | Issue-report button (broken clip, short strand) seeding #82 inventory | Installer | S/M | C+A | ✓ |
| 12 | Running same-day efficiency ticker during shadow | Installer | M | A+C | |
| 13 | Calls-per-hour-worked on the scoreboard | Office | S | C | ✓ |
| 14 | Unified owner daily digest (sales + ops + advertising + attendance) | Owner | M | A+C | ✓ |
| 15 | Unified morning command screen (all queues, badge counts, both apps) | Owner | M | C+A | ✓ |
| 16 | One-tap approve-all-clean, exceptions-only surfacing | Owner | S | A | ✓ |
| 17 | Backup-approver escalation alert near payroll cutoff | Owner | S | A | ✓ |
| 18 | New-hire wizard spanning both systems | Owner | M | C+A | |
| 19 | Weekly owner scorecard (labor %, efficiency, top-ups, placements, calls, bookings) | Owner | M | A | |
| 20 | Payroll-day wizard (export -> processor) | Owner | M/L | A | blocked on vendor pick |
| 21 | Campaign ROI report (placements -> calls -> quotes -> booked $) | Office | M/L | A+B | blocked on Flow F |
| 22 | Install-quality-to-coaching feed (yellow slips tagging the selling rep in /coach) | Office | S/M | C | |

## OPEN decisions feeding this list (in DECISIONS.md)

- How the advertising crew is PAID at all in v1 (hourly day clock / per-sign
  piece rate / off-system). Blocks nothing technical, blocks their week one.
- Payroll vendor (Gusto/QuickBooks/other): unblocks #20. Copilot exported to
  QuickBooks/Gusto today, so the current plan is a payroll-day regression
  until this is picked.
- Which digest is THE digest (recommend: the Quote Tool's morning digest
  becomes the unified owner digest, #14; the hub's coaching digest folds in).
- Sign inventory scope for season 1 (#1 covers the worker side; full stock
  tracking belongs to the #82 inventory epic).
- Off-season review cadence (calendar task: tokens, certs, crons, storage
  cost snapshot).

# Spec: Speed-to-Lead Tracking

> Written 2026-08-21. A design spec, not code. It defines how the copilot should measure how fast we
> contact a new lead, which the timing audit (`AUDIT-speed-to-lead-and-timing.md`) found we cannot
> measure today. Build owner: Jason for the backend capture, Naldo for the dashboard tile. This needs a
> branch and Jason's review to implement. Schema references below are from a point-in-time read of the
> migrations and should be checked against the current code before building.

## Why
Speed-to-lead is the best-evidenced lever in the whole sales playbook: contacting a lead in the first
minute versus later is a large multiplier, and about half of customers go with whoever responds first.
Right now we fly blind on it. We can't tell you our average response time, so we can't improve it. This
spec fixes that.

## The metric, defined plainly
For every new lead, we want to know: **how many minutes passed between the lead coming in and our
first contact.** Three numbers, from most to least important:

1. **Time to first attempt** = first outbound call (or text) to that lead, minus when the lead came in.
2. **Time to first connect** = first call that reached a live person, minus when the lead came in.
3. **Under-target rate** = the percent of leads first-attempted within the target window.

Targets to grade against: **under 5 minutes is great, under 1 minute is elite.** Anything over an hour
is a miss.

## What we need to capture (the gap today)
The `calls` table already records `started_at` (when a call began) and links to a lead via `lead_id`.
The `leads` table records `queued_at` (when the lead entered our queue). The problem: `queued_at` is
when *our system* queued it, not when the *customer* actually raised their hand. Those can differ by a
lot. So we need the true lead-in moment.

Add (or map) these on the `leads` record:
- **`lead_created_at`** — the real moment the customer showed interest, taken from the GoHighLevel
  webhook payload (the contact or opportunity created timestamp), not our queue time.
- **`first_contact_at`** — timestamp of the first outbound attempt to this lead (first `calls.started_at`
  for that `lead_id`, or first outbound text if we add texting).
- **`first_connect_at`** — timestamp of the first attempt that actually reached a person.

Then the three metrics above are simple subtractions.

## Business-hours adjustment (so the number isn't lying)
A lead that comes in at 11pm should not count as an "11-hour response" if we call at 10am. Measure from
the **next time we're open**, not the raw clock.
- Define business hours in one place (Settings). Per the timing audit, these should reach into the
  evening (say 8am to 8pm), because that's when homeowners are actually reachable.
- For after-hours leads, start the clock at the next open minute.
- Report both raw and business-hours-adjusted, but grade on the adjusted one.

## Edge cases to handle
- **Inbound phone calls:** if the customer calls us, they *are* the contact, so time-to-lead is
  essentially zero. Measure speed-to-lead only for leads that came in another way (web form, Facebook,
  quote request) and needed a callback. Tag the source so the two don't get mixed.
- **Multiple attempts:** only the *first* attempt counts for the metric. Don't reset it on later calls.
- **No-answer vs connect:** first attempt counts even if it went to voicemail. First connect is separate.
- **De-dupe:** if the same person comes in twice, tie both to one lead so we don't double-count.

## How it should surface
- **Dashboard tile (Naldo's area):** "Median speed-to-lead this week" with a green/yellow/red against
  the 5-minute target, plus the under-target rate.
- **Weekly digest line:** "This week: median first-contact X minutes, Y% within 5 minutes." Trend versus
  last week.
- **Per-lead, in the queue:** show a small "waiting Xm" timer on each unworked lead, so the pressure is
  visible in the moment. This is the part that actually changes behavior.

## Acceptance criteria (so we know it's done and correct)
- For a lead created at a known time, first-attempt and first-connect minutes compute correctly.
- An after-hours lead measures from next open, not raw clock.
- Inbound phone leads are excluded from the response-time metric (or shown separately as ~0).
- Multiple calls to one lead do not inflate or reset the first-attempt time.
- The dashboard tile and digest line match a hand-checked sample of 10 leads.

## What this is not
- Not a code change from this session. It's the blueprint.
- Not a queue-priority change. Surfacing the timer may naturally improve behavior, but actually
  re-ordering the queue by evening/Saturday windows is a separate build (the one we deferred).

## Suggested first step (cheap, this week, no build)
Before any code, hand-measure it for one week: for 20 leads, note when each came in (from GoHighLevel)
and when you first called. That gives you a real baseline number to beat, and it'll tell you fast
whether this is a big problem or a small one before Jason invests in building the automated version.

# YLL Deep-Dive #2: Speed-to-Lead and Call Timing (Audited on Your Real Data)

> Written 2026-08-21. Hormozi is blunt that the things *around* the call move more revenue than
> anything said *on* it. This audits your actual 1,211 calls (May 2025 to Aug 2026, US Eastern time)
> against those "sales multipliers" and tells you where the real opportunity is.

## First, a correction I owe you
In the earlier diagnosis I flagged a possible "connect-rate problem," saying 77% of calls never
became conversations. **That was wrong, and here's why.** It came from the 260 *scored* calls, which
are a skewed sample, and it leaned on a `duration_seconds` field that is mostly unpopulated (it reads
0 when the value is simply missing, not when the call was zero seconds).

When I check **all 1,211 real transcripts**, the picture is healthy:

| Measure | Result |
|---|---|
| Median call length | ~2,700 characters of real conversation |
| Calls that are substantial conversations (300+ chars) | ~92% |
| Clear voicemails / no-connects | ~8% (about 102 calls) |

**So you do not have a connect-rate problem.** Your team reaches a live person the large majority of
the time. Do not spend effort "fixing" this. The voicemail-plus-text script still covers the ~8% that
don't connect, and that's enough.

## The real finding: you're calling when people aren't home
Here is when your 1,211 calls actually happened, in Eastern time:

| Time block | Calls | Share |
|---|---|---|
| Before 9am | 29 | 2% |
| 9am to 12pm | 354 | 29% |
| 12pm to 5pm | 631 | 52% |
| **5pm to 8pm (evening)** | **165** | **14%** |
| After 8pm | 32 | 3% |

**81% of your calls happen 9am to 5pm, when homeowners are at work.** Only 14% land in the 5-to-8pm
window when people are home, relaxed, and both decision-makers are in the same room. That last point
matters a lot for you, because your data also shows the "I need to talk to my spouse" wall, and
evening calls quietly solve it by catching both people at once.

And by day of week:

| Day | Calls |
|---|---|
| Mon | 198 |
| Tue | 182 |
| Wed | 184 |
| Thu | 195 |
| Fri | 193 |
| **Sat** | **102** |
| Sun | 157 |

You already call seven days a week, which is good. **Saturday is your soft spot** at barely half a
weekday, and Saturday is prime time for a homeowner deciding on their house.

(Note: this is when calls *happened*, both inbound and outbound mixed. You control the timing of the
outbound follow-up calls, so that's where to shift.)

## The operational playbook (Hormozi's multipliers, adapted to you)

### 1. Move outbound follow-up into the evening and onto Saturday
This is your single biggest operational lever, straight from your own data. For the calls you
initiate, weight them toward 5 to 8pm and Saturday morning. You'll reach more live people, catch both
decision-makers, and get better conversations. Try blocking a "power hour" from 6 to 7pm.

### 2. Speed-to-lead: instrument it, then hit under 5 minutes
Hormozi's most-cited stat: contacting a lead within a minute versus later is a massive multiplier, and
about half of customers go with whoever responds first. **Right now I can't measure your speed-to-lead**,
because the historical data doesn't record when the lead came in versus when you first called. That's
the first thing to fix.
- Capture the "lead created" timestamp (from GoHighLevel) and the "first touch" timestamp, so you can
  see minutes-to-first-contact per lead.
- Target: first touch under 5 minutes during business hours. Your copilot's queue is built for exactly
  this.

### 3. Bias to same-day and next-day booking
Show-up rates are highest for same-day and next-day appointments. When you book a design review or an
on-site, push for the soonest slot, not "sometime next week." If your calendar is too full to offer
same-day, that's a signal to add capacity, not to book further out.

### 4. Run a real reminder sequence (kills no-shows)
For every booked appointment, layer manual reminders on top of the automated ones, at three moments:
- **24 hours before:** a personal note that shows prep. "Excited for tomorrow, I pulled up your home
  and sketched two looks to show you."
- **Morning of:** "Still good for 2pm today? Looking forward to it."
- **1 hour before:** "See you in an hour, I'll call [number]."
The 24-hour one especially: showing you did prep makes people feel worse about no-showing.

### 5. Give idle reps an "off-the-call" job
When a rep has a gap between appointments, the default should be: call new leads and try to pull
existing appointments earlier ("I had a slot open up today, want it?"). That turns dead time into
booked, sooner, higher-show appointments. Right now that idle time is probably just idle.

### 6. Add a "call now" option on the web form
When someone finishes a quote request, offer a "call us now" button in addition to "schedule." A
customer who calls you has the strongest intent there is. Cheap to add, and it catches the hottest
leads at their hottest moment.

### 7. Keep the voicemail-plus-text combo for the ~8% that don't connect
You already have this scripted. It covers the small slice that goes to voicemail. That's the right
amount of effort for that slice, no more.

## What NOT to chase
- Do not build a project around connect rate. It's healthy.
- Do not obsess over the `duration_seconds` metric until it's populated reliably. It's currently noise.

## The one number to start tracking this week
**Minutes from lead-in to first contact.** You can't improve what you don't measure, and this is the
lever with the highest proven payoff. Everything else in this doc is easier once you can see it.

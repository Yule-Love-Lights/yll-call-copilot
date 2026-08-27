# What Your Real Calls Show — Sales Diagnosis (from the production database)

> Pulled 2026-08-21 from the live `yll-call-copilot` Supabase project, not from samples or the
> summary plan. Numbers come from the `transcripts` (1,211 calls), `learnings` (1,200 AI-extracted
> call breakdowns), and `call_scores` (260 graded calls) tables. Customer names and numbers were
> never pulled into this analysis, only the sales content and the scores.

## The corpus
- **1,211 real calls**, May 12, 2025 to Aug 7, 2026. 683 different customers. Average call about 5,700 characters of talk.
- **1,200** have an AI-extracted breakdown (objections in the customer's own words, what worked, what failed, how price was handled).
- **260** have a full graded scorecard.

## Read this caveat first, so the numbers are honest
Of the 260 graded calls, **199 are under 60 seconds** (voicemails and quick no-connects), and the median call length is basically zero. Only **33 are genuine conversations over two minutes**. So any "average score out of 100" is dragged way down by calls that never became conversations. Below, when a number could be distorted by that, I give you both the all-calls figure and the 33-real-conversations figure. The cleanest, least-distorted numbers are the behavior rates (did the rep do X or not), and those are the most damning.

Also: only 32 calls are labeled "booked" and 149 "not booked" in the whole system, so booked-versus-lost comparisons are directional, not statistical proof.

---

## THE headline: you were right about the pain-point gap, and here is the exact size of it

You said the team does a bad job understanding people and selling to their real driver. The data agrees, hard.

The coach grades whether the rep **read the customer's emotional state, named it back to them, and ran the matching track** (done-for-you for the busy, proof-and-guarantees for the guarded, and so on). Across 260 graded calls:

- **Named the emotion back to the customer: 6 calls. That is 2.3%.** On the 33 real conversations, 3 of 33, about 9%.
- **Ran the matching track: 19 calls. That is 7.3%.** On real conversations, 3 of 33, about 9%.
- Average emotional-read grade: 2.5 out of 5 across all calls, 3.4 out of 5 on real conversations.

So **more than 9 out of 10 calls never diagnose, name, and match the customer's driver.** That is the single clearest finding in your whole call history, and it is precisely the thing you said was broken.

And here is who is calling you: of the graded calls where a state was read, customers skew **guarded (68) and busy (77)**, over excited (17) and status (37). Guarded and busy are the two states that most need proof, guarantees, and a done-for-you takeover. Those are exactly the moves the calls are skipping.

---

## The free money you are leaving on the table

When the moment on the call actually fit the offer, here is how often the rep said the line:

| Offer line | Fit the moment | Rep said it | Hit rate |
|---|---|---|---|
| All-inclusive, "the quote is the bill" | 169 | 30 | **18%** |
| 48-hour fix guarantee | 189 | 24 | **13%** |
| Referral ask ($100) | 29 | 3 | **10%** |
| Rebook / lock next season | 52 | 3 | **6%** |

Read that again: **82% to 94% of the moments to use your best offers went by in silence.** The plan built the guarantees. The calls almost never fire them. This is the cheapest fix you have, because the words already exist and cost nothing to say.

---

## Discovery: thin, and often absent

- **247 of 1,200 calls (21%) asked the customer zero questions.** One in five.
- Average questions per call: **2.6**.
- Discovery score on real conversations: **6.5 out of 25 (26%)**.
- Reps talk **53%** of the time on average. The best-evidenced winning ratio is closer to 43% rep, 57% customer. You are talking a little too much and asking a little too little.

## Closing and follow-up: the biggest booked-versus-lost separator

- Among the AI-flagged failures, the top actionable clusters were **"left it to email / weak follow-up" (164)**, **"price handling" (164)**, and **"no booking or weak close" (119)**.
- In the booked-versus-lost cut, the one thing that separated them was the **close**: booked calls scored **5.1 out of 20** on closing, lost calls **2.8**. Nearly double. Discovery and question-count did not separate them. The close did.
- Translation: you are not losing deals for lack of talking. You are losing them at the moment someone needs to ask for the booking and lock a specific next step, and instead the call ends in "I'll send you something."

## Objections, in your customers' actual words

From 575 calls that hit an objection:

- **Price is the number one objection by a mile: 230 mentions.** Reps overcame about 73% of the ones that resolved either way. That is respectable, not broken.
- **Where you actually lose: competitor comparison.** "I'm getting other quotes" resolved 5 won to 7 lost, your worst-performing objection category. When customers shop you against another bid, you lose more than you win.
- "Let me check with my spouse" (87% overcome) and "let me think about it" (91%) are handled well. Those are not your problem.
- "Not interested" is mostly lost, which is normal.

---

## What you are doing RIGHT (also from the data)

- **Warmth and rapport is the number one thing that works on your calls: 580 mentions.** Your Chick-fil-A hospitality DNA is real and it shows up in the transcripts. This is a genuine, rare asset. Build on it, do not lose it.
- **When reps explain the all-inclusive value, it works: 533 mentions.** The stack lands when they bother to say it. The problem is they only say it 18% of the time.
- **Setting the next step works when they do it: 482 mentions.**
- Reps do overcome most price and spouse objections. The raw sales instinct is there. The structure is not.

---

## The one-line diagnosis

It is not attitude and it is not talent. Your reps are warm and likeable, and customers respond to that. What is missing is **structure**: they do not diagnose the customer's driver and name it back (2.3%), they do not fire the guarantees that would remove the fear (6% to 18%), and they do not close and lock a specific next step (the exact thing that separates your booked calls from your lost ones). A script that forces those three moves, every call, is the whole game.

---

## What this changes in the sales script (V1 was aimed right, here is the re-prioritization)

The V1 script already puts discovery, emotional naming, value, close, and guarantees in the right order. The data says to weight it like this:

1. **Make "name it back and match the track" impossible to skip.** This is your 2.3% behavior and your biggest gap. It should be a hard checkbox on the cheat card, not a suggestion.
2. **Turn the guarantee lines into non-optional prompts.** All-inclusive and the 48-hour fix at the value step, referral at the close. These are 82%-to-94%-missed and free.
3. **Drill the binary close and the recap.** It is the single thing that separates your booked calls from your lost ones.
4. **Add a competitor-comparison objection turn.** "I'm getting other quotes" is where you actually lose, and V1 does not handle it head-on yet.
5. **Push discovery from 2.6 questions toward 3 or 4, including the emotional why**, and get the rep talk ratio down toward 43%.

## Worth a second look (operational, outside the script)
77% of your graded calls never became a conversation (voicemail or under a minute). That points at a connect-rate or speed-to-lead problem in the outbound slice, separate from call quality. Might be worth checking how many outbound attempts are landing on voicemail before we optimize what happens once someone picks up.

# Live customer calling activation blockers

Status: **positively disabled; not approved for customer calls**
Date: 2026-08-13

Customer live calling must remain disabled with
`LIVE_CUSTOMER_CALLS_ENABLED=false`. The deployment preflight rejects `true`,
the bridge refuses to start without the positive flag, and the Hub must fail
closed or direct an employee to Practice. Existing Twilio, WebSocket, and
Deepgram code is preparatory implementation, not evidence that the complete
customer-call lifecycle is safe.

Do not remove the preflight rejection or enable the flag until every gate below
has implementation evidence, automated coverage where feasible, real-provider
and real-browser smoke evidence, and human approval.

## Required activation gates

1. **Provider lifecycle and CallSid reconciliation**
   Persist and reconcile the Twilio CallSid and signed provider callbacks for
   initiated, ringing, answered, no-answer, busy, failed, canceled, and
   completed outcomes. Duplicate and out-of-order callbacks must converge on
   one allowed state without reopening terminal work.

2. **Hangup and multitab ownership**
   Prove that employee hangup, customer hangup, provider failure, tab close,
   refresh, reconnect, and two tabs competing for one call leave one owner and
   one terminal result. A stale browser must not end or resume another active
   attempt.

3. **Stream-drain and late-final barrier**
   Ending a call must stop new media, drain accepted media, wait for final
   recognition results, persist them, and only then freeze the transcript and
   start downstream scoring or follow-up work. A late final utterance must not
   be silently dropped.

4. **Ordered durable segment delivery**
   Media-derived transcript segments need a durable ordered outbox or
   equivalent retry boundary. Retries, reconnects, duplicates, gaps, and
   out-of-order delivery must be detected and resolved idempotently without
   losing or rewriting accepted segments.

5. **Correct two-track speaker attribution**
   Validate Twilio inbound and outbound media tracks end to end so customer and
   employee speech cannot be reversed or mixed. Store an explicit speaker for
   each accepted segment and prove attribution with a real two-party call.

6. **Deepgram utterance accumulation**
   Accumulate interim/final recognition using Deepgram `speech_final` and
   punctuation boundaries so an utterance is neither emitted repeatedly nor
   split or truncated incorrectly. Reconnect behavior must not duplicate the
   last utterance.

7. **Atomic coaching cooldown**
   Coaching generation and delivery need one atomic cooldown/deduplication
   decision per call and rule. Concurrent segments and retries must not produce
   duplicate coaching prompts.

8. **Recovery and idempotency**
   Start, provider attach, stream attach, segment append, end, completion, and
   post-call processing must all distinguish the same retry from a conflicting
   request. Prove recovery after a lost HTTP response, bridge restart, Hub
   restart, browser reload, and provider callback replay.

9. **Real provider and browser smokes**
   Run signed Twilio Voice and Media Streams calls through the deployed bridge
   and Hub with Deepgram, including employee hangup, customer hangup,
   no-answer, failure, refresh, and reconnect. Verify the employee experience
   on supported desktop and mobile browsers, and confirm the final transcript,
   speakers, duration, outcome, metrics, and follow-up state from persisted
   records.

## Activation decision

After all nine gates pass, a separate reviewed change may remove the temporary
preflight rejection and permit `LIVE_CUSTOMER_CALLS_ENABLED=true` in a staged
environment. Production activation still requires a human decision and a
postdeploy smoke. Failure of any gate keeps the flag false.

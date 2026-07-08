# YLL Call Copilot

Internal tool for Yule Love Lights. It helps human reps handle inbound calls and warm outbound calls (past customers, quote follow-ups, referrals, rebooks): look up the customer in GoHighLevel before dialing, keep a living call playbook per line of business, and (in later phases) get on-call guidance. The AI coaches the rep and never speaks to the customer.

## Setup

1. `npm install`
2. Copy `.env.example` to `.env.local` and fill the values from the Yule Love Lights accounts (GoHighLevel private integration token + location id, Supabase project keys). If you also want inbound calls/texts to trigger the dashboard's screen-pop, set `GHL_WEBHOOK_SECRET` to a long random string and point the GHL workflow's webhook action at `https://<this app>/api/webhooks/ghl?key=<the same value>` (see `.env.example` for details).
3. Create your own staff login -- there is no self-signup; sign-in requires both a Supabase Auth account and an `app_users` row, and `node scripts/create-user.mjs <email> <temp-password> [role]` is the only way to create both at once. Don't leave the password lying around in a file once you've signed in with it.
4. `npm run dev` and open http://localhost:3000, then sign in with the account from step 3.

The app runs fine with an empty `.env.local`; the health panel just shows red until the keys are in. Auth is the exception -- once real Supabase keys are filled in, every route requires a signed-in, allowlisted user, so step 3 is not optional once you're past a bare `.env.local`.

## Checks

Run all three before committing:

```bash
npx tsc --noEmit
npm run lint
npm test
```

## Live coaching (Phase 4)

`/call/[leadId]/live` works with zero extra setup: click "Start coached call" and it runs the built-in simulator (a scripted realistic call), which drives the real trigger-detection engine and real Claude-generated coaching cards -- only the audio is fake. No Twilio or Deepgram account exists yet.

To switch a call over to a real phone call once those accounts exist:

1. Fill in the Twilio/Deepgram vars in `.env.local` (see `.env.example` for what each one is and where to find it).
2. Start the standalone media bridge alongside `npm run dev`: `node scripts/live-bridge.mjs`. It listens on `ws://localhost:8787` for Twilio's Media Stream and transcribes with Deepgram. Twilio requires a `wss://` URL in production, so put a TLS tunnel (e.g. `ngrok http 8787`, using its `wss://` forwarding address) in front of it and point `LIVE_BRIDGE_URL` at that address.
3. Point the Twilio TwiML App's Voice "request URL" at `https://<this app>/api/twilio/voice`.

This path is coded against Twilio's and Deepgram's documented APIs but has never run against a live account -- treat it as unverified until someone confirms a real call end to end.

## Notes

- Auth is live (staff allowlist sign-in, gated by `src/proxy.ts`). Supabase row level security is still service-role only; every table's RLS policy is deferred until a later pass.
- Never commit `.env.local` or paste real key values into code, logs, or chat.

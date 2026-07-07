# YLL Call Copilot

Internal tool for Yule Love Lights. It helps human reps make cold calls: look up the customer in GoHighLevel before dialing, see connection health at a glance, and (in later phases) get on-call guidance. Phase 0 is the skeleton only: a dashboard with a health panel, a GoHighLevel contact search, and a Supabase schema file. No telephony and no AI calls yet.

## Setup

1. `npm install`
2. Copy `.env.example` to `.env.local` and fill the values from the Yule Love Lights accounts (GoHighLevel private integration token + location id, Supabase project keys).
3. `npm run dev` and open http://localhost:3000

The app runs fine with an empty `.env.local`; the health panel just shows red until the keys are in.

## Checks

Run all three before committing:

```bash
npx tsc --noEmit
npm run lint
npm test
```

## Notes

- Auth and Supabase row level security land in a later phase (Phase 0.5). The migration in `supabase/migrations/0001_init.sql` is not applied anywhere yet.
- Never commit `.env.local` or paste real key values into code, logs, or chat.

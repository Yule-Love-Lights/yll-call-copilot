# YLL Call Copilot

Internal tool for Yule Love Lights. It helps human reps handle inbound calls and warm outbound calls (past customers, quote follow-ups, referrals, rebooks): look up the customer in GoHighLevel before dialing, keep a living call playbook per line of business, and (in later phases) get on-call guidance. The AI coaches the rep and never speaks to the customer.

## Setup

1. `npm install`
2. Copy `.env.example` to `.env.local` and fill the values from the Yule Love Lights accounts (GoHighLevel private integration token + location id, Supabase project keys). HighLevel Marketplace webhooks use signed-body verification; a private workflow may temporarily use the `GHL_WEBHOOK_SECRET` compatibility path described in `.env.example`.
3. Create a legacy Office staff login. There is no self-signup. `node scripts/create-user.mjs <email> <temp-password> [role]` accepts only the closed `rep`/`office` bootstrap inputs and calls the service-role-only provisioning routine that atomically ensures the immutable employee/Auth UUID link, Office membership, audit, and guarded `app_users` compatibility projection. It does not print an employee identifier and never creates Owner/Admin, Advertising, Installer, or Manager access. Production phone OTP and field provisioning remain disabled until their later reviewed activation.
4. `npm run dev` and open http://localhost:3000, then sign in with the account from step 3.

Authentication and authorization fail closed: protected pages and non-health APIs return a generic 503 until the complete Supabase configuration is present. Once configured, every employee route requires a signed-in user, a resolved immutable employee actor, and the route's explicit capabilities. The identity-foundation branch preserves existing Office employee UUIDs while adding the new Hub-owned identity and membership model; it does not activate phone OTP.

## Checks

Run all three before committing:

```bash
npx tsc --noEmit
npm run lint
npm test
```

## Live coaching safety status

Practice calls are isolated in the Practice surface. The former simulated
customer-call path has been removed. Real customer calling is positively
disabled with `LIVE_CUSTOMER_CALLS_ENABLED=false`, and customer follow-up sends
are independently disabled with `GHL_FOLLOWUP_SEND_ENABLED=false`. Do not turn
either flag on from setup instructions. Each requires the separately reviewed
provider, recovery, permission, idempotency, and real-browser activation gates
in `docs/operations-hub/LIVE-CALLING-ACTIVATION-BLOCKERS.md`.

## Deploy note (Vercel)

`vercel.json` carries six GET cron entries. Every request must present Vercel's `Authorization: Bearer $CRON_SECRET` header; `CRON_ENABLED=true` is a separate kill switch. Configure both values in the Vercel project before enabling scheduled work.

Before a production deploy, run `npm run verify:auth-config` in an environment
containing the production variable names. It validates Supabase, the two
approved Owner/Admin Auth UUIDs, cron authentication, and any enabled
Twilio/live-bridge/legacy-HighLevel credential set without printing values.

Vercel runs the separate branch-aware `npm run build:vercel` command for every
deployment. Phone OTP can activate only on the exact `staging` preview branch;
see `docs/operations-hub/STAGING-PHONE-AUTH-DEPLOYMENT.md` for the required
credential scoping and fail-closed deployment contract.

## Notes

- Auth is live and capability-gated in `src/proxy.ts`; every current page/API method is declared in `src/lib/auth/routePolicy.ts`. Default-deny row-level security is merged. Hosted preflight, remaining resource-scoped service-role checks, immutable identity integration, and semantic persona tests remain field-release gates.
- Never commit `.env.local` or paste real key values into code, logs, or chat.

// /reset-password — where a Supabase recovery email link lands. Public (no
// staff session required, same as /login and /forgot-password — see
// proxy.ts). Server component so we can check Supabase config server-side
// and show the friendly banner instead of a broken form, same pattern as
// /login and /forgot-password. Everything recovery-session-specific
// happens client-side (the token lives in the URL hash, never sent to the
// server) — see ResetPasswordForm.

import { isSupabaseConfigured } from '@/lib/supabase';
import ResetPasswordForm from './ResetPasswordForm';

export const dynamic = 'force-dynamic';

export default function ResetPasswordPage() {
  const configured = isSupabaseConfigured();

  return (
    <main className="mx-auto w-full max-w-sm px-6 py-16">
      <h1 className="text-2xl font-semibold text-[var(--op-text)]">Set a new password</h1>
      <p className="mt-1 text-sm text-[var(--op-dim)]">Choose a new password for your account.</p>

      <div className="mt-8">
        {configured ? (
          <ResetPasswordForm />
        ) : (
          <div className="rounded-2xl border border-[rgba(122,94,32,0.3)] bg-[rgba(232,184,98,0.12)] px-4 py-3 text-sm font-medium text-[var(--brand-gold-deep)]">
            Supabase not configured — set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
            and SUPABASE_SERVICE_ROLE_KEY in .env.local.
          </div>
        )}
      </div>
    </main>
  );
}

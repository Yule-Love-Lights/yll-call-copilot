// /forgot-password — request a password reset email. Public (no staff
// session required, same as /login — see proxy.ts). Server component so we
// can check Supabase config server-side and show the friendly banner
// instead of a broken form, same pattern as /login.

import { isSupabaseConfigured } from '@/lib/supabase';
import { resolvePhoneAuthConfiguration } from '@/lib/auth/phoneAuth';
import { redirect } from 'next/navigation';
import ForgotPasswordForm from './ForgotPasswordForm';

export const dynamic = 'force-dynamic';

export default function ForgotPasswordPage() {
  if (resolvePhoneAuthConfiguration().mode !== 'disabled') redirect('/login');
  const configured = isSupabaseConfigured();

  return (
    <main className="mx-auto w-full max-w-sm px-6 py-16">
      <h1 className="text-2xl font-semibold text-[var(--op-text)]">Reset your password</h1>
      <p className="mt-1 text-sm text-[var(--op-dim)]">
        Enter your email and we&apos;ll send you a link to set a new password.
      </p>

      <div className="mt-8">
        {configured ? (
          <ForgotPasswordForm />
        ) : (
          <div className="rounded-2xl border border-[rgba(122,94,32,0.3)] bg-[rgba(232,184,98,0.12)] px-4 py-3 text-sm font-medium text-[var(--brand-gold-deep)]">
            {process.env.NODE_ENV === 'development'
              ? 'Supabase is not configured. Set the three Supabase variables in .env.local.'
              : 'Authentication is temporarily unavailable. Please try again later.'}
          </div>
        )}
      </div>
    </main>
  );
}

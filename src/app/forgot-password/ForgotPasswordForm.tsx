'use client';

// Requests a Supabase password-reset email via the browser client. Always
// shows the same neutral confirmation whether or not the address has an
// account — resetPasswordForEmail never reveals that either, and neither
// do we. redirectTo points at /reset-password, which is where the emailed
// link lands and picks up the recovery session from the URL hash.

import Link from 'next/link';
import { useState } from 'react';
import { getSupabaseBrowserClient } from '@/lib/supabase-browser';

export default function ForgotPasswordForm() {
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const supabase = getSupabaseBrowserClient();
    if (!supabase) {
      setError('Supabase is not configured.');
      return;
    }

    setSubmitting(true);
    await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setSubmitting(false);

    // Neutral response either way — never reveal whether the email is
    // registered, so a real error from Supabase is treated the same as
    // success here.
    setDone(true);
  }

  if (done) {
    return (
      <div className="rounded-2xl border border-[var(--op-border)] bg-[var(--op-raised)] px-4 py-3 text-sm text-[var(--op-text-2)] shadow-[var(--shadow-1)]">
        If that address has an account, a reset link is on the way.
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label htmlFor="email" className="block text-sm font-medium text-[var(--op-text)]">
          Email
        </label>
        <input
          id="email"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          className="mt-1 w-full rounded-md border border-[var(--op-border-mid)] bg-white px-3 py-2 text-sm text-[var(--op-text)] outline-none focus:border-[var(--brand-gold-deep)]"
        />
      </div>

      {error && <p className="text-sm text-[var(--brand-red)]">{error}</p>}

      <button
        type="submit"
        disabled={submitting}
        className="w-full rounded-md bg-[var(--brand-gold)] px-3 py-2 text-sm font-semibold text-[var(--brand-evergreen)] hover:bg-[var(--brand-gold-bright)] disabled:opacity-50"
      >
        {submitting ? 'Sending…' : 'Send reset link'}
      </button>

      <p className="text-center text-sm">
        <Link href="/login" className="text-[var(--op-dim)] hover:underline">
          Back to sign in
        </Link>
      </p>
    </form>
  );
}

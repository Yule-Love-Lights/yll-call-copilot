'use client';

// Landing point for a Supabase recovery email link. The link's token lives
// in the URL hash (never sent to the server) — createBrowserClient picks it
// up automatically (detectSessionInUrl, on by default in the browser; see
// supabase-browser.ts) and either fires a PASSWORD_RECOVERY auth event or
// already has the session established by the time getSession() below
// resolves. Either path flips the form to 'ready'. If neither ever fires
// (someone opened this page cold, or the link already expired), the
// timeout below settles on 'invalid' instead of leaving the form stuck on
// "checking" forever.
//
// Once the password is set, a session already exists (that's what recovery
// gives us), so we route straight into the app.

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { getSupabaseBrowserClient } from '@/lib/supabase-browser';

type Status = 'checking' | 'ready' | 'invalid';

const bannerClass =
  'rounded-2xl border border-[rgba(122,94,32,0.3)] bg-[rgba(232,184,98,0.12)] px-4 py-3 text-sm font-medium text-[var(--brand-gold-deep)]';
const inputClass =
  'mt-1 w-full rounded-md border border-[var(--op-border-mid)] bg-white px-3 py-2 text-sm text-[var(--op-text)] outline-none focus:border-[var(--brand-gold-deep)]';

export default function ResetPasswordForm() {
  const router = useRouter();
  // Lazy initializer, not an effect: whether Supabase is configured never
  // changes across renders, so a null client settles 'invalid' immediately
  // instead of a synchronous setState from inside the effect below.
  const [status, setStatus] = useState<Status>(() => (getSupabaseBrowserClient() ? 'checking' : 'invalid'));
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;

    let cancelled = false;

    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (cancelled) return;
      if (event === 'PASSWORD_RECOVERY' && session) {
        setStatus('ready');
      }
    });

    supabase.auth.getSession().then(({ data }) => {
      if (!cancelled && data.session) setStatus('ready');
    });

    // Give detectSessionInUrl a moment to process the hash before deciding
    // there's no recovery session — only downgrades a still-'checking'
    // status, so it never clobbers an already-'ready' one.
    const timer = setTimeout(() => {
      if (!cancelled) setStatus(current => (current === 'checking' ? 'invalid' : current));
    }, 2000);

    return () => {
      cancelled = true;
      listener.subscription.unsubscribe();
      clearTimeout(timer);
    };
  }, []);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    const supabase = getSupabaseBrowserClient();
    if (!supabase) {
      setError('Supabase is not configured.');
      return;
    }

    setSubmitting(true);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setSubmitting(false);

    if (updateError) {
      setError(updateError.message);
      return;
    }

    router.push('/');
    router.refresh();
  }

  if (status === 'checking') {
    return <p className="text-sm text-[var(--op-dim)]">Checking your link…</p>;
  }

  if (status === 'invalid') {
    return (
      <div className="space-y-3">
        <div className={bannerClass}>This reset link is invalid or expired. Request a new one.</div>
        <p className="text-sm">
          <Link href="/forgot-password" className="text-[var(--op-dim)] hover:underline">
            Request a new reset link
          </Link>
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label htmlFor="password" className="block text-sm font-medium text-[var(--op-text)]">
          New password
        </label>
        <input
          id="password"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          className={inputClass}
        />
      </div>

      <div>
        <label htmlFor="confirmPassword" className="block text-sm font-medium text-[var(--op-text)]">
          Confirm password
        </label>
        <input
          id="confirmPassword"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          value={confirmPassword}
          onChange={e => setConfirmPassword(e.target.value)}
          className={inputClass}
        />
      </div>

      {error && <p className="text-sm text-[var(--brand-red)]">{error}</p>}

      <button
        type="submit"
        disabled={submitting}
        className="w-full rounded-md bg-[var(--brand-gold)] px-3 py-2 text-sm font-semibold text-[var(--brand-evergreen)] hover:bg-[var(--brand-gold-bright)] disabled:opacity-50"
      >
        {submitting ? 'Saving…' : 'Set new password'}
      </button>
    </form>
  );
}

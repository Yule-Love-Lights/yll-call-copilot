// /coach — the signed-in rep's own feedback feed: one glanceable card per
// scored call, win first, at most one fix, the score tucked into a
// collapsed detail. Server component so we can check Supabase config
// server-side, same pattern as /analytics and /queue. No nav link added
// here — wiring it into the nav is a follow-up.

import Link from 'next/link';
import { isSupabaseConfigured } from '@/lib/supabase';
import FeedbackFeed from './FeedbackFeed';

export const dynamic = 'force-dynamic';

export default function CoachPage() {
  const configured = isSupabaseConfigured();

  return (
    <main className="coach-surface mx-auto w-full max-w-3xl px-4 py-12 sm:px-6">
      <Link
        href="/"
        className="inline-flex min-h-[40px] items-center text-sm font-semibold text-[var(--op-dim)] hover:underline"
      >
        ← Dashboard
      </Link>
      <h1 className="mt-2 text-[28px] font-extrabold leading-tight tracking-[-.02em] text-[var(--op-text)]">
        Your call feedback
      </h1>
      <p className="mt-1 text-[15px] text-[var(--op-dim)]">One card per scored call. Your win first, one thing to try next.</p>

      <div className="mt-8">
        {configured ? (
          <FeedbackFeed />
        ) : (
          <div className="rounded-2xl border border-[rgba(122,94,32,0.3)] bg-[rgba(232,184,98,0.12)] px-4 py-3 text-sm font-medium text-[var(--brand-gold-deep)]">
            Supabase not configured — set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, and
            SUPABASE_SERVICE_ROLE_KEY in .env.local.
          </div>
        )}
      </div>
    </main>
  );
}

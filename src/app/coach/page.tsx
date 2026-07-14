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
    <main className="mx-auto w-full max-w-3xl px-6 py-12">
      <Link href="/" className="text-sm text-zinc-500 hover:underline">
        ← Dashboard
      </Link>
      <h1 className="mt-2 text-2xl font-semibold">Your call feedback</h1>
      <p className="mt-1 text-sm text-zinc-500">One card per scored call. Your win first, one thing to try next.</p>

      <div className="mt-8">
        {configured ? (
          <FeedbackFeed />
        ) : (
          <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
            Supabase not configured — set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, and
            SUPABASE_SERVICE_ROLE_KEY in .env.local.
          </div>
        )}
      </div>
    </main>
  );
}

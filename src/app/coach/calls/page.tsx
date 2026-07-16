// /coach/calls -- the owner's call-review browser: read a scored call's
// transcript next to its full scorecard to prep a one-on-one. This is
// coaching prep, never a watch list -- reps never see this page (their
// private per-call view is /coach). Server component so we can check
// Supabase config server-side, same pattern as /digest and /coach. The
// role gate itself lives in the API (GET /api/coach/calls); a rep who
// lands here gets the friendly not-for-reps message from CallBrowser,
// same UX as /digest's 403 handling.

import Link from 'next/link';
import { isSupabaseConfigured } from '@/lib/supabase';
import CallBrowser from './CallBrowser';

export const dynamic = 'force-dynamic';

export default function CallReviewPage() {
  const configured = isSupabaseConfigured();

  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-12">
      <Link href="/" className="text-sm text-zinc-500 hover:underline">
        ← Dashboard
      </Link>
      <h1 className="mt-2 text-2xl font-semibold">Call review</h1>
      <p className="mt-1 text-sm text-zinc-500">
        Read a scored call next to its scorecard to get ready for a one-on-one. Coaching prep, not a watch list.
      </p>

      <div className="mt-8">
        {configured ? (
          <CallBrowser />
        ) : (
          <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
            Supabase not configured. Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, and
            SUPABASE_SERVICE_ROLE_KEY in .env.local.
          </div>
        )}
      </div>
    </main>
  );
}

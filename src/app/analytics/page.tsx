// /analytics — vertical + date-range picker, stat tiles, outcome-by-opener
// and version win-rate tables, a calls/day trend, and the compounding
// brain's latest narrative + "Run weekly review" button for the selected
// vertical. Server component so we can check Supabase config server-side,
// same pattern as /verticals and /queue.

import Link from 'next/link';
import { isSupabaseConfigured } from '@/lib/supabase';
import AnalyticsView from './AnalyticsView';

export const dynamic = 'force-dynamic';

export default function AnalyticsPage() {
  const configured = isSupabaseConfigured();

  return (
    <main className="mx-auto w-full max-w-4xl px-6 py-12">
      <Link href="/" className="text-sm text-zinc-500 hover:underline">
        ← Dashboard
      </Link>
      <h1 className="mt-2 text-2xl font-semibold">Analytics</h1>
      <p className="mt-1 text-sm text-zinc-500">Call performance and the compounding brain, by line of business.</p>

      <div className="mt-8">
        {configured ? (
          <AnalyticsView />
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

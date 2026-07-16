// /scoreboard — the transparency scoreboard + the two wall metrics
// (docs/SALES-EXCELLENCE-PLAN.md). Server component so we can check
// Supabase config server-side, same pattern as /analytics.

import Link from 'next/link';
import { isSupabaseConfigured } from '@/lib/supabase';
import ScoreboardView from './ScoreboardView';

export const dynamic = 'force-dynamic';

export default function ScoreboardPage() {
  const configured = isSupabaseConfigured();

  return (
    <main className="mx-auto w-full max-w-4xl px-6 py-12">
      <Link href="/" className="text-sm text-zinc-500 hover:underline">
        ← Dashboard
      </Link>
      <h1 className="mt-2 text-2xl font-semibold">Scoreboard</h1>
      <p className="mt-1 text-sm text-zinc-500">
        Everyone&apos;s scores and trends, made safe: improvement counts as much as the top score, and corrections stay one-on-one.
      </p>

      <div className="mt-8">
        {configured ? (
          <ScoreboardView />
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

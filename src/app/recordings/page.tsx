// /recordings — visibility into the GHL recordings pipeline (Workstream 1):
// sync state, counts by status, and the last 50 recordings. Server
// component so we can check Supabase config server-side, same pattern as
// /queue and /verticals.

import Link from 'next/link';
import { isSupabaseConfigured } from '@/lib/supabase';
import RecordingsView from './RecordingsView';

export const dynamic = 'force-dynamic';

export default function RecordingsPage() {
  const configured = isSupabaseConfigured();

  return (
    <main className="mx-auto w-full max-w-3xl px-6 py-12">
      <Link href="/" className="text-sm text-zinc-500 hover:underline">
        ← Dashboard
      </Link>

      <div className="mt-8">
        {configured ? (
          <RecordingsView />
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

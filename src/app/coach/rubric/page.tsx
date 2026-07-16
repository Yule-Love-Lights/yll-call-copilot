// /coach/rubric — view and edit the active scoring rubric (weights,
// instructions per dimension), with a version history list and restore.
// Server component so we can check Supabase config server-side, same
// pattern as /verticals/[id].

import { isSupabaseConfigured } from '@/lib/supabase';
import RubricEditor from './RubricEditor';

export const dynamic = 'force-dynamic';

export default function RubricPage() {
  const configured = isSupabaseConfigured();

  return (
    <main className="mx-auto w-full max-w-2xl px-6 py-12">
      <div>
        <h1 className="text-2xl font-semibold">Call scoring rubric</h1>
        <p className="mt-1 text-sm text-zinc-500">
          The two-sided, experience-weighted scorecard every substantive call is graded against. A warm no can
          outscore a pushy yes.
        </p>
      </div>

      <div className="mt-8">
        {configured ? (
          <RubricEditor />
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

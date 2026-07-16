// /digest -- the self-generating weekly digest for Naldo's ~30-minute Friday
// steer: team trends, the training focus, the best call and the roughest
// moment, this week's playbook proposals, and a role-play scenario built
// from the roughest real moment. Server component so we can check Supabase
// config server-side, same pattern as /analytics and /verticals.

import Link from 'next/link';
import { isSupabaseConfigured } from '@/lib/supabase';
import DigestView from './DigestView';

export const dynamic = 'force-dynamic';

export default function DigestPage() {
  const configured = isSupabaseConfigured();

  return (
    <main className="mx-auto w-full max-w-4xl px-6 py-12">
      <Link href="/" className="text-sm text-zinc-500 hover:underline">
        ← Dashboard
      </Link>
      <h1 className="mt-2 text-2xl font-semibold">Weekly digest</h1>
      <p className="mt-1 text-sm text-zinc-500">Team trends, this week&apos;s training focus, and the week&apos;s playbook proposals -- generated every Friday.</p>

      <div className="mt-8">
        {configured ? (
          <DigestView />
        ) : (
          <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
            Supabase not configured — set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, and SUPABASE_SERVICE_ROLE_KEY in .env.local.
          </div>
        )}
      </div>
    </main>
  );
}

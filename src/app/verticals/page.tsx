// /verticals — list verticals and create new ones. Server component so we
// can check Supabase config server-side and show a friendly banner instead of
// a broken list when the env vars are missing (same pattern as /contacts).

import Link from 'next/link';
import { isSupabaseConfigured } from '@/lib/supabase';
import VerticalsList from './VerticalsList';

// Config is read per-request, not baked at build time — otherwise the
// "not configured" banner could stick after the env vars are added.
export const dynamic = 'force-dynamic';

export default function VerticalsPage() {
  const configured = isSupabaseConfigured();

  return (
    <main className="mx-auto w-full max-w-2xl px-6 py-12">
      <Link href="/" className="text-sm text-zinc-500 hover:underline">
        ← Dashboard
      </Link>
      <h1 className="mt-2 text-2xl font-semibold">Verticals</h1>
      <p className="mt-1 text-sm text-zinc-500">Cold-call playbooks by line of business.</p>

      <div className="mt-8">
        {configured ? (
          <VerticalsList />
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

// /call/[leadId] — the call console. Server component so we can check
// Supabase config server-side, same pattern as /verticals and /queue.

import Link from 'next/link';
import { isSupabaseConfigured } from '@/lib/supabase';
import CallConsole from './CallConsole';

export const dynamic = 'force-dynamic';

export default async function CallConsolePage({ params }: { params: Promise<{ leadId: string }> }) {
  const { leadId } = await params;
  const configured = isSupabaseConfigured();

  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-12">
      <Link href="/queue" className="text-sm text-zinc-500 hover:underline">
        ← Queue
      </Link>

      <div className="mt-8">
        {configured ? (
          <CallConsole leadId={leadId} />
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

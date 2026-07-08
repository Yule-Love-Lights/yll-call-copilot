// /call/[leadId] — the call console. Server component so we can check
// Supabase config server-side, same pattern as /verticals and /queue.

import Link from 'next/link';
import { isSupabaseConfigured } from '@/lib/supabase';
import CallConsole from './CallConsole';

export const dynamic = 'force-dynamic';

export default async function CallConsolePage({
  params,
  searchParams,
}: {
  params: Promise<{ leadId: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { leadId } = await params;
  // Set when the rep just finished a live-coached call (LiveConsole's
  // onEnd() appends it) — see CallConsole, which sends it back on save so
  // POST /api/calls updates that call instead of inserting a second one.
  const { callId: callIdParam } = await searchParams;
  const callId = typeof callIdParam === 'string' ? callIdParam : null;
  const configured = isSupabaseConfigured();

  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-12">
      <div className="flex items-center justify-between">
        <Link href="/queue" className="text-sm text-zinc-500 hover:underline">
          ← Queue
        </Link>
        {configured && (
          <Link href={`/call/${leadId}/live`} className="text-sm text-blue-600 hover:underline dark:text-blue-400">
            Live coaching →
          </Link>
        )}
      </div>

      <div className="mt-8">
        {configured ? (
          <CallConsole leadId={leadId} initialCallId={callId} />
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

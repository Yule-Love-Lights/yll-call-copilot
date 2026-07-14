// /coach/offer: the offer editor for the guarantees and offer moves as
// structured, versioned data (WORKSTREAM 8). Server component so we can
// check Supabase config server-side, same pattern as /verticals.

import { isSupabaseConfigured } from '@/lib/supabase';
import OfferSettings from './OfferSettings';

export const dynamic = 'force-dynamic';

export default function OfferPage() {
  const configured = isSupabaseConfigured();

  return (
    <main className="mx-auto w-full max-w-2xl px-6 py-12">
      <h1 className="text-2xl font-semibold">Offer and guarantees</h1>
      <p className="mt-1 text-sm text-zinc-500">
        These lines are what reps say on the call, and what the call scorer grades against.
      </p>

      <div className="mt-8">
        {configured ? (
          <OfferSettings />
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

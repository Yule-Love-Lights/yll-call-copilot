// /brain — the "Brain" intelligence view (Wave 1, PR A): one page that
// presents everything the app already knows (learnings, playbook
// proposals, knowledge documents/notes, call scores, transcript outcomes,
// plus brain_insights from sibling PR B) as three linked lenses. Server
// component so we can check Supabase config server-side before rendering
// the client fetcher, same pattern as /coach and /scoreboard.

import Link from 'next/link';
import { isSupabaseConfigured } from '@/lib/supabase';
import BrainView from './BrainView';

export const dynamic = 'force-dynamic';

const notConfiguredBanner = (
  <div className="rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
    Supabase not configured — set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, and SUPABASE_SERVICE_ROLE_KEY in
    .env.local.
  </div>
);

export default function BrainPage() {
  const configured = isSupabaseConfigured();

  return (
    <main className="coach-surface mx-auto w-full max-w-5xl px-4 py-12 sm:px-6">
      <Link href="/" className="inline-flex min-h-[40px] items-center text-sm font-semibold text-[var(--op-dim)] hover:underline">
        ← Dashboard
      </Link>
      <h1 className="mt-2 text-[28px] font-extrabold leading-tight tracking-[-.02em] text-[var(--op-text)]">The Brain</h1>
      <p className="mt-1 text-[15px] text-[var(--op-dim)]">
        Everything the app has learned, in one place: the market, what converts, and how the team is doing.
      </p>

      <div className="mt-8">{configured ? <BrainView /> : notConfiguredBanner}</div>
    </main>
  );
}

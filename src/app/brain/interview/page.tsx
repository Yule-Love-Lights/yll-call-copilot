// /brain/interview -- "Interview yourself" (Wave 1 PR B, Seed the Brain): a
// guided walk through the curated question bank, distilled into
// brain_insights by one Claude call at the end. Server component so we can
// check Supabase config server-side, same pattern as /brain/seed and
// /coach/offer.

import Link from 'next/link';
import { isSupabaseConfigured } from '@/lib/supabase';
import InterviewFlow from './InterviewFlow';

export const dynamic = 'force-dynamic';

export default function BrainInterviewPage() {
  const configured = isSupabaseConfigured();

  return (
    <main className="coach-surface mx-auto w-full max-w-2xl px-4 py-12 sm:px-6">
      <Link
        href="/"
        className="inline-flex min-h-[40px] items-center text-sm font-semibold text-[var(--op-dim)] hover:underline"
      >
        ← Dashboard
      </Link>
      <h1 className="mt-2 text-[28px] font-extrabold leading-tight tracking-[-.02em] text-[var(--op-text)]">
        Interview yourself
      </h1>
      <p className="mt-1 text-[15px] text-[var(--op-dim)]">
        A few honest questions about your business. Answer in your own words; we will turn it into notes the team
        can use.
      </p>

      <div className="mt-8">
        {configured ? (
          <InterviewFlow />
        ) : (
          <div className="rounded-2xl border border-[rgba(122,94,32,0.3)] bg-[rgba(232,184,98,0.12)] px-4 py-3 text-sm font-medium text-[var(--brand-gold-deep)]">
            Supabase not configured: set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, and
            SUPABASE_SERVICE_ROLE_KEY in .env.local.
          </div>
        )}
      </div>
    </main>
  );
}

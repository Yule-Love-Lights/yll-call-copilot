// /brain/seed -- "Seed the Brain" (Wave 1 PR B): type a piece of knowledge
// straight into the brain, no call or interview needed. Server component so
// we can check Supabase config server-side, same pattern as /coach/offer.

import Link from 'next/link';
import { isSupabaseConfigured } from '@/lib/supabase';
import SeedInsightForm from './SeedInsightForm';

export const dynamic = 'force-dynamic';

export default function BrainSeedPage() {
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
        Seed the brain
      </h1>
      <p className="mt-1 text-[15px] text-[var(--op-dim)]">
        Type in something you know, and the team&apos;s playbook and calls get smarter. No call needed.
      </p>

      <div className="mt-8">
        {configured ? (
          <SeedInsightForm />
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

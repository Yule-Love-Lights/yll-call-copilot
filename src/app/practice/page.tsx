// /practice — pick a scenario (vertical + customer emotional state +
// optional objection to drill) and start a turn-based voice roleplay
// against an AI-played homeowner. Server component so we can check Supabase
// config server-side, same pattern as /coach.

import Link from 'next/link';
import { isSupabaseConfigured } from '@/lib/supabase';
import PracticeScenarioPicker from './PracticeScenarioPicker';

export const dynamic = 'force-dynamic';

export default function PracticePage() {
  const configured = isSupabaseConfigured();

  return (
    <main className="coach-surface mx-auto w-full max-w-2xl px-4 py-12 sm:px-6">
      <Link
        href="/"
        className="inline-flex min-h-[40px] items-center text-sm font-semibold text-[var(--op-dim)] hover:underline"
      >
        ← Dashboard
      </Link>
      <h1 className="mt-2 text-[28px] font-extrabold leading-tight tracking-[-.02em] text-[var(--op-text)]">Practice a call</h1>
      <p className="mt-1 text-[15px] text-[var(--op-dim)]">
        Rehearse against an AI-played homeowner, then get scored on the exact same rubric as a real call. Private to you --
        never on the team board.
      </p>

      <div className="mt-8">
        {configured ? (
          <PracticeScenarioPicker />
        ) : (
          <div className="rounded-2xl border border-[rgba(122,94,32,0.3)] bg-[rgba(232,184,98,0.12)] px-4 py-3 text-sm font-medium text-[var(--brand-gold-deep)]">
            Supabase not configured — set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, and
            SUPABASE_SERVICE_ROLE_KEY in .env.local.
          </div>
        )}
      </div>
    </main>
  );
}

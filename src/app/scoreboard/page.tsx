// /scoreboard — the transparency scoreboard + the two wall metrics
// (docs/SALES-EXCELLENCE-PLAN.md). Server component so we can check
// Supabase config server-side, same pattern as /analytics.
//
// `?tv=1` is the shop-wall takeover (PR 3 of 3): read here via the page's
// own `searchParams` prop and handed down to ScoreboardView as a plain
// boolean, rather than reading useSearchParams inside the client component
// — Next's own recommendation when a Server Component page already has the
// value, and it sidesteps the Suspense-boundary dance useSearchParams
// needs in a static build. TV mode renders full-bleed (no breadcrumb, no
// heading) since ScoreboardView's own fixed-position stage covers the rest
// of the page including CoachNav.

import Link from 'next/link';
import { isSupabaseConfigured } from '@/lib/supabase';
import ScoreboardView from './ScoreboardView';

export const dynamic = 'force-dynamic';

const notConfiguredBanner = (
  <div className="rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
    Supabase not configured — set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, and SUPABASE_SERVICE_ROLE_KEY in
    .env.local.
  </div>
);

export default async function ScoreboardPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const configured = isSupabaseConfigured();
  const { tv } = await searchParams;
  const isTv = tv === '1';

  if (isTv) {
    return configured ? <ScoreboardView tv /> : <main className="mx-auto w-full max-w-4xl px-6 py-12">{notConfiguredBanner}</main>;
  }

  return (
    <main className="mx-auto w-full max-w-4xl px-6 py-12">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/" className="text-sm text-[var(--op-dim)] hover:underline">
            ← Dashboard
          </Link>
          <h1 className="mt-2 text-2xl font-bold text-[var(--op-text)]">Scoreboard</h1>
          <p className="mt-1 text-sm text-[var(--op-dim)]">
            Everyone&apos;s scores and trends, made safe: improvement counts as much as the top score, and corrections stay
            one-on-one.
          </p>
        </div>
        <Link
          href="/scoreboard?tv=1"
          className="inline-flex items-center rounded-full border border-[var(--op-border-mid)] bg-white/70 px-3.5 py-1.5 text-[13px] font-semibold text-[var(--op-text-2)] hover:bg-white"
        >
          TV mode
        </Link>
      </div>

      <div className="mt-8">{configured ? <ScoreboardView /> : notConfiguredBanner}</div>
    </main>
  );
}

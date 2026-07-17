'use client';

// The pre-shell home content, unchanged in behavior: connection health
// panel, this-week stat tiles + the compounding brain's one-liner
// (GET /api/dashboard/summary), sign-out, and the inbound-call screen pop.
// Split out of page.tsx (PR 2 of 3, the shell/home rebuild) purely so the
// new server-rendered daily dashboard can be a server component -- this
// piece still needs the browser (two fetches on mount, a click handler), so
// it stays client-side. Same fetches, same shape as before; only the zinc
// classes became the brand tokens (globals.css, PR 1). The old flat
// quick-link nav list is gone -- CoachNav.tsx (rendered from layout.tsx)
// replaces it everywhere.

import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { getSupabaseBrowserClient } from '@/lib/supabase-browser';
import InboundPop from './InboundPop';

type Health = { ghl: boolean; supabase: boolean; claude: boolean; version: string };

type Summary = {
  configured: boolean;
  calls?: number;
  interested?: number;
  queueDepth?: number;
  inboundPops?: number;
  latestBrainReview?: { verticalName: string; narrative: string; createdAt: string } | null;
};

function StatusDot({ ok }: { ok: boolean }) {
  return <span className={`inline-block h-2.5 w-2.5 rounded-full ${ok ? 'bg-green-500' : 'bg-red-500'}`} />;
}

function StatTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col gap-1 rounded-md border border-[var(--op-border)] p-3">
      <span className="text-xs font-medium uppercase text-[var(--op-dim)]">{label}</span>
      <span className="text-2xl font-semibold text-[var(--op-text)]">{value}</span>
    </div>
  );
}

export default function HomeConnectionPanel() {
  const router = useRouter();
  const [health, setHealth] = useState<Health | null>(null);
  const [failed, setFailed] = useState(false);
  const [summary, setSummary] = useState<Summary | null>(null);

  useEffect(() => {
    fetch('/api/health')
      .then(res => res.json())
      .then(setHealth)
      .catch(() => setFailed(true));
  }, []);

  useEffect(() => {
    fetch('/api/dashboard/summary')
      .then(res => res.json())
      .then(setSummary)
      .catch(() => {});
  }, []);

  async function handleSignOut() {
    const supabase = getSupabaseBrowserClient();
    if (supabase) await supabase.auth.signOut();
    router.push('/login');
    router.refresh();
  }

  return (
    <div>
      <div className="flex items-start justify-between">
        <h2 className="text-2xl font-semibold text-[var(--op-text)]">YLL Call Copilot</h2>
        <button
          type="button"
          onClick={handleSignOut}
          className="rounded-md border border-[var(--op-border-mid)] px-3 py-1.5 text-sm text-[var(--op-dim)] hover:bg-[rgba(11,20,15,0.05)]"
        >
          Sign out
        </button>
      </div>
      <p className="mt-1 text-sm text-[var(--op-dim)]">
        Copilot for inbound and warm outbound calls at Yule Love Lights.
      </p>

      {summary?.configured && (
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatTile label="Calls this week" value={summary.calls ?? 0} />
          <StatTile label="Interested" value={summary.interested ?? 0} />
          <StatTile label="Queue depth" value={summary.queueDepth ?? 0} />
          <StatTile label="Inbound pops" value={summary.inboundPops ?? 0} />
        </div>
      )}

      {summary?.latestBrainReview && (
        <Link
          href="/analytics"
          className="mt-4 block truncate rounded-md border border-[var(--op-border)] px-3 py-2 text-sm text-[var(--op-text-2)] hover:bg-[rgba(11,20,15,0.04)]"
          title={summary.latestBrainReview.narrative}
        >
          🧠 {summary.latestBrainReview.verticalName}: {summary.latestBrainReview.narrative}
        </Link>
      )}

      <section className="mt-8 rounded-md border border-[var(--op-border)]">
        <h3 className="border-b border-[var(--op-border)] px-4 py-3 text-sm font-semibold text-[var(--op-text)]">
          Connection health
        </h3>
        {failed ? (
          <p className="px-4 py-3 text-sm text-[var(--brand-red)]">Could not reach /api/health.</p>
        ) : !health ? (
          <p className="px-4 py-3 text-sm text-[var(--op-dim)]">Checking…</p>
        ) : (
          <ul className="divide-y divide-[var(--op-border)] text-sm">
            <li className="flex items-center justify-between px-4 py-3">
              <span className="text-[var(--op-text)]">GoHighLevel</span>
              <span className="flex items-center gap-2 text-[var(--op-dim)]">
                <StatusDot ok={health.ghl} />
                {health.ghl ? 'configured' : 'not configured'}
              </span>
            </li>
            <li className="flex items-center justify-between px-4 py-3">
              <span className="text-[var(--op-text)]">Supabase</span>
              <span className="flex items-center gap-2 text-[var(--op-dim)]">
                <StatusDot ok={health.supabase} />
                {health.supabase ? 'configured' : 'not configured'}
              </span>
            </li>
            <li className="flex items-center justify-between px-4 py-3">
              <span className="text-[var(--op-text)]">Claude</span>
              <span className="flex items-center gap-2 text-[var(--op-dim)]">
                <StatusDot ok={health.claude} />
                {health.claude ? 'configured' : 'not configured'}
              </span>
            </li>
            <li className="flex items-center justify-between px-4 py-3">
              <span className="text-[var(--op-text)]">App version</span>
              <span className="text-[var(--op-dim)]">{health.version}</span>
            </li>
          </ul>
        )}
      </section>

      <InboundPop />
    </div>
  );
}

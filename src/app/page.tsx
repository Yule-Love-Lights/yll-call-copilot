'use client';

// Dashboard: this-week stat row + the compounding brain's latest one-liner
// (GET /api/dashboard/summary), quick links, and the connection health panel
// from Phase 0. Kept light per the brief — no new state beyond what those
// two fetches need.

import Link from 'next/link';
import { useRouter } from 'next/navigation';
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
  return (
    <span
      className={`inline-block h-2.5 w-2.5 rounded-full ${ok ? 'bg-green-500' : 'bg-red-500'}`}
    />
  );
}

function StatTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col gap-1 rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
      <span className="text-xs font-medium uppercase text-zinc-500">{label}</span>
      <span className="text-2xl font-semibold">{value}</span>
    </div>
  );
}

const quickLinkClass = 'text-sm font-medium text-blue-600 hover:underline dark:text-blue-400';

export default function Home() {
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
    <main className="mx-auto w-full max-w-2xl px-6 py-12">
      <div className="flex items-start justify-between">
        <h1 className="text-2xl font-semibold">YLL Call Copilot</h1>
        <button
          type="button"
          onClick={handleSignOut}
          className="rounded-md border border-zinc-200 px-3 py-1.5 text-sm text-zinc-500 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900"
        >
          Sign out
        </button>
      </div>
      <p className="mt-1 text-sm text-zinc-500">
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
          className="mt-4 block truncate rounded-md border border-zinc-200 px-3 py-2 text-sm text-zinc-600 hover:bg-zinc-50 dark:border-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-900"
          title={summary.latestBrainReview.narrative}
        >
          🧠 {summary.latestBrainReview.verticalName}: {summary.latestBrainReview.narrative}
        </Link>
      )}

      <nav className="mt-6 flex flex-wrap gap-4">
        <Link href="/contacts" className={quickLinkClass}>
          Contacts →
        </Link>
        <Link href="/queue" className={quickLinkClass}>
          Call queue →
        </Link>
        <Link href="/inbox" className={quickLinkClass}>
          Email inbox →
        </Link>
        <Link href="/verticals" className={quickLinkClass}>
          Verticals →
        </Link>
        <Link href="/analytics" className={quickLinkClass}>
          Analytics →
        </Link>
        <Link href="/recordings" className={quickLinkClass}>
          Call recordings →
        </Link>
        <Link href="/digest" className={quickLinkClass}>
          Weekly digest →
        </Link>
        <Link href="/scoreboard" className={quickLinkClass}>
          Scoreboard →
        </Link>
        <Link href="/second-mile" className={quickLinkClass}>
          Second mile →
        </Link>
        <Link href="/coach/calls" className={quickLinkClass}>
          Call review →
        </Link>
      </nav>

      <section className="mt-8 rounded-md border border-zinc-200 dark:border-zinc-800">
        <h2 className="border-b border-zinc-200 px-4 py-3 text-sm font-semibold dark:border-zinc-800">
          Connection health
        </h2>
        {failed ? (
          <p className="px-4 py-3 text-sm text-red-600 dark:text-red-400">
            Could not reach /api/health.
          </p>
        ) : !health ? (
          <p className="px-4 py-3 text-sm text-zinc-500">Checking…</p>
        ) : (
          <ul className="divide-y divide-zinc-200 text-sm dark:divide-zinc-800">
            <li className="flex items-center justify-between px-4 py-3">
              <span>GoHighLevel</span>
              <span className="flex items-center gap-2 text-zinc-500">
                <StatusDot ok={health.ghl} />
                {health.ghl ? 'configured' : 'not configured'}
              </span>
            </li>
            <li className="flex items-center justify-between px-4 py-3">
              <span>Supabase</span>
              <span className="flex items-center gap-2 text-zinc-500">
                <StatusDot ok={health.supabase} />
                {health.supabase ? 'configured' : 'not configured'}
              </span>
            </li>
            <li className="flex items-center justify-between px-4 py-3">
              <span>Claude</span>
              <span className="flex items-center gap-2 text-zinc-500">
                <StatusDot ok={health.claude} />
                {health.claude ? 'configured' : 'not configured'}
              </span>
            </li>
            <li className="flex items-center justify-between px-4 py-3">
              <span>App version</span>
              <span className="text-zinc-500">{health.version}</span>
            </li>
          </ul>
        )}
      </section>

      <InboundPop />
    </main>
  );
}

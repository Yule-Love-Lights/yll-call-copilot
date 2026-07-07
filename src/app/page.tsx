'use client';

// Dashboard shell. Phase 0 shows connection health only; call workflow
// surfaces land in later phases.

import Link from 'next/link';
import { useEffect, useState } from 'react';

type Health = { ghl: boolean; supabase: boolean; version: string };

function StatusDot({ ok }: { ok: boolean }) {
  return (
    <span
      className={`inline-block h-2.5 w-2.5 rounded-full ${ok ? 'bg-green-500' : 'bg-red-500'}`}
    />
  );
}

export default function Home() {
  const [health, setHealth] = useState<Health | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    fetch('/api/health')
      .then(res => res.json())
      .then(setHealth)
      .catch(() => setFailed(true));
  }, []);

  return (
    <main className="mx-auto w-full max-w-2xl px-6 py-12">
      <h1 className="text-2xl font-semibold">YLL Call Copilot</h1>
      <p className="mt-1 text-sm text-zinc-500">
        Cold-call copilot for Yule Love Lights reps.
      </p>

      <nav className="mt-6">
        <Link
          href="/contacts"
          className="text-sm font-medium text-blue-600 hover:underline dark:text-blue-400"
        >
          Contacts →
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
              <span>App version</span>
              <span className="text-zinc-500">{health.version}</span>
            </li>
          </ul>
        )}
      </section>
    </main>
  );
}

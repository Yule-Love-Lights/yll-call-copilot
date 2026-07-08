'use client';

// The ranked lead queue: a "Build queue" button + last-build time, vertical
// and minimum-score filters, a "Claimed by me" section pinned to the top,
// and the rest ranked by score. Talks to GET/POST /api/queue,
// POST /api/queue/build, and POST /api/leads/[id]/decide.

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { getSupabaseBrowserClient } from '@/lib/supabase-browser';

type Lead = {
  id: string;
  ghlContactId: string | null;
  fullName: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  verticalSlug: string | null;
  reason: string;
  openerHint: string | null;
  score: number;
  source: string;
  status: 'queued' | 'claimed' | 'done' | 'dismissed';
  claimedBy: string | null;
  queuedAt: string;
};

type QueueResponse = {
  configured: boolean;
  migrated?: boolean;
  reason?: string;
  leads: Lead[];
  lastBuildAt: string | null;
};

type VerticalOption = { id: string; slug: string; name: string };

type TopObjection = { objection: string; count: number; pct: number };

const amberBannerClass =
  'rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200';
const primaryButtonClass =
  'rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300';
const secondaryButtonClass =
  'rounded-md border border-zinc-300 px-3 py-1 text-sm hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-900';
const selectClass =
  'rounded-md border border-zinc-300 px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900';

function scoreBadgeClass(score: number): string {
  if (score >= 100) return 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300';
  if (score >= 80) return 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300';
  return 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300';
}

function LeadRowCard({
  lead,
  mine,
  acting,
  onClaim,
  onDismiss,
}: {
  lead: Lead;
  mine: boolean;
  acting: boolean;
  onClaim: () => void;
  onDismiss: () => void;
}) {
  return (
    <li className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">{lead.fullName ?? '(no name)'}</span>
          <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${scoreBadgeClass(lead.score)}`}>
            {lead.score}
          </span>
          {lead.openerHint && (
            <span className="rounded-full border border-zinc-300 px-2 py-0.5 text-xs text-zinc-600 dark:border-zinc-700 dark:text-zinc-400">
              {lead.openerHint}
            </span>
          )}
          {mine && (
            <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-800 dark:bg-blue-950 dark:text-blue-300">
              Claimed by you
            </span>
          )}
        </div>
        <span className="text-sm text-zinc-500">{lead.reason}</span>
        <span className="text-xs text-zinc-400">
          {lead.phone ?? 'no phone'} · {lead.source}
          {lead.verticalSlug ? ` · ${lead.verticalSlug}` : ''}
        </span>
      </div>
      <div className="flex shrink-0 gap-2">
        {lead.status === 'queued' && (
          <>
            <button onClick={onClaim} disabled={acting} className={secondaryButtonClass}>
              {acting ? '…' : 'Claim'}
            </button>
            <button onClick={onDismiss} disabled={acting} className={secondaryButtonClass}>
              Dismiss
            </button>
          </>
        )}
        <Link href={`/call/${lead.id}`} className={primaryButtonClass}>
          Open
        </Link>
      </div>
    </li>
  );
}

export default function QueueList() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [lastBuildAt, setLastBuildAt] = useState<string | null>(null);
  const [migrated, setMigrated] = useState(true);
  const [reason, setReason] = useState<string | null>(null);
  const [status, setStatus] = useState<'loading' | 'done' | 'error'>('loading');
  const [building, setBuilding] = useState(false);
  const [buildMessage, setBuildMessage] = useState<string | null>(null);
  const [actingId, setActingId] = useState<string | null>(null);
  const [myEmail, setMyEmail] = useState<string | null>(null);
  const [verticals, setVerticals] = useState<VerticalOption[]>([]);
  const [verticalFilter, setVerticalFilter] = useState('');
  const [minScoreFilter, setMinScoreFilter] = useState('0');

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;
    supabase.auth.getUser().then(({ data }) => setMyEmail(data.user?.email ?? null));
  }, []);

  useEffect(() => {
    fetch('/api/verticals')
      .then(res => res.json())
      .then(json =>
        setVerticals(
          (json.verticals ?? []).map((v: { id: string; slug: string; name: string }) => ({ id: v.id, slug: v.slug, name: v.name })),
        ),
      )
      .catch(() => {});
  }, []);

  // Light per-vertical insight: when the list is filtered to one vertical,
  // show its top-3 objections (from the existing insights endpoint) so a rep
  // scanning that vertical's queue knows what they're about to hear. Cached
  // by slug; the visible list is derived at render time so the effect only
  // ever calls setState inside the fetch callback
  // (react-hooks/set-state-in-effect).
  const [objectionsBySlug, setObjectionsBySlug] = useState<Record<string, TopObjection[]>>({});
  useEffect(() => {
    const selected = verticals.find(v => v.slug === verticalFilter);
    if (!selected) return;
    let cancelled = false;
    fetch(`/api/verticals/${selected.id}/insights`)
      .then(res => res.json())
      .then(json => {
        if (cancelled) return;
        const top = (json.insights?.topObjections ?? []).slice(0, 3) as TopObjection[];
        setObjectionsBySlug(prev => ({ ...prev, [selected.slug]: top }));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [verticalFilter, verticals]);
  const topObjections = verticalFilter ? (objectionsBySlug[verticalFilter] ?? []) : [];

  // Not an async function called directly from useEffect — every setState
  // call lives inside a .then()/.catch() callback (react-hooks/set-state-in-effect).
  const load = useCallback(() => {
    const params = new URLSearchParams();
    if (verticalFilter) params.set('vertical', verticalFilter);
    if (minScoreFilter && minScoreFilter !== '0') params.set('minScore', minScoreFilter);
    return fetch(`/api/queue?${params}`)
      .then(res => res.json())
      .then((json: QueueResponse) => {
        setMigrated(json.migrated !== false);
        setReason(json.reason ?? null);
        setLeads(json.leads ?? []);
        setLastBuildAt(json.lastBuildAt ?? null);
        setStatus('done');
      })
      .catch(() => setStatus('error'));
  }, [verticalFilter, minScoreFilter]);

  useEffect(() => {
    load();
  }, [load]);

  async function onBuild() {
    setBuilding(true);
    setBuildMessage(null);
    try {
      const res = await fetch('/api/queue/build', { method: 'POST' });
      const json = await res.json();
      if (json.migrated === false) {
        setBuildMessage(json.reason ?? 'Run migration 0004 first.');
        return;
      }
      if (json.configured === false || json.reason) {
        setBuildMessage(json.reason ?? 'Could not build the queue.');
        return;
      }
      setBuildMessage(`Added ${json.added}, refreshed ${json.refreshed}.`);
      await load();
    } finally {
      setBuilding(false);
    }
  }

  async function onDecide(id: string, action: 'claim' | 'dismiss') {
    setActingId(id);
    try {
      await fetch(`/api/leads/${id}/decide`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      await load();
    } finally {
      setActingId(null);
    }
  }

  const mineFirst = leads.filter(l => l.status === 'claimed' && l.claimedBy === myEmail);
  const rest = leads.filter(l => !(l.status === 'claimed' && l.claimedBy === myEmail));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Call queue</h1>
        <p className="mt-1 text-sm text-zinc-500">Ranked leads pulled from GoHighLevel.</p>
      </div>

      {!migrated && <div className={amberBannerClass}>{reason ?? 'Run migration 0004 first.'}</div>}
      {migrated && reason && <div className={amberBannerClass}>{reason}</div>}

      <div className="flex flex-wrap items-center gap-3">
        <button onClick={onBuild} disabled={building} className={primaryButtonClass}>
          {building ? 'Building…' : 'Build queue'}
        </button>
        <span className="text-sm text-zinc-500">
          {lastBuildAt ? `Last built ${new Date(lastBuildAt).toLocaleString()}` : 'Never built yet'}
        </span>
        {buildMessage && <span className="text-sm text-zinc-500">{buildMessage}</span>}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm text-zinc-500">
          Vertical
          <select value={verticalFilter} onChange={e => setVerticalFilter(e.target.value)} className={selectClass}>
            <option value="">All</option>
            {verticals.map(v => (
              <option key={v.slug} value={v.slug}>
                {v.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm text-zinc-500">
          Min score
          <select value={minScoreFilter} onChange={e => setMinScoreFilter(e.target.value)} className={selectClass}>
            <option value="0">Any</option>
            <option value="60">60+</option>
            <option value="80">80+</option>
            <option value="100">100</option>
          </select>
        </label>
      </div>

      {topObjections.length > 0 && (
        <div className="rounded-md bg-zinc-50 p-3 text-xs text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
          <p className="font-medium">Top objections for this vertical:</p>
          <ul className="mt-1 list-disc pl-4">
            {topObjections.map(o => (
              <li key={o.objection}>
                {o.objection} ({o.pct}% of calls)
              </li>
            ))}
          </ul>
        </div>
      )}

      {status === 'loading' && <p className="text-sm text-zinc-500">Loading…</p>}
      {status === 'error' && <p className="text-sm text-red-600 dark:text-red-400">Could not load the queue.</p>}

      {status === 'done' && leads.length === 0 && (
        <p className="text-sm text-zinc-500">Nothing queued. Click &quot;Build queue&quot; to pull fresh leads.</p>
      )}

      {mineFirst.length > 0 && (
        <div>
          <h2 className="mb-2 text-sm font-semibold">Claimed by me</h2>
          <ul className="divide-y divide-zinc-200 rounded-md border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
            {mineFirst.map(lead => (
              <LeadRowCard
                key={lead.id}
                lead={lead}
                mine
                acting={actingId === lead.id}
                onClaim={() => onDecide(lead.id, 'claim')}
                onDismiss={() => onDecide(lead.id, 'dismiss')}
              />
            ))}
          </ul>
        </div>
      )}

      {rest.length > 0 && (
        <div>
          {mineFirst.length > 0 && <h2 className="mb-2 text-sm font-semibold">Everyone else</h2>}
          <ul className="divide-y divide-zinc-200 rounded-md border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
            {rest.map(lead => (
              <LeadRowCard
                key={lead.id}
                lead={lead}
                mine={false}
                acting={actingId === lead.id}
                onClaim={() => onDecide(lead.id, 'claim')}
                onDismiss={() => onDecide(lead.id, 'dismiss')}
              />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

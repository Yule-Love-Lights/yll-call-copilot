'use client';

// The /brain client view: fetches GET /api/brain on mount and renders the
// three lenses (market/leads/coaching) plus the "learns every call" stats
// strip under the hero. Styling follows the coach family
// (coach-card/coach-surface tokens from globals.css, brand-* CSS
// variables) — same fetch-on-mount + loading/empty/error pattern as
// src/app/coach/FeedbackFeed.tsx and src/app/digest/DigestView.tsx.
//
// Each lens card leads with a few headline numbers, then a "Details" toggle
// reveals the full breakdown — same progressive-disclosure shape
// FeedbackFeed's card uses for its score detail, so a busy owner gets the
// gist at a glance and can dig in only when they want to.

import { useEffect, useState } from 'react';
import BrainHero from './BrainHero';
import type { BrainInsight, BrainStats, CoachingLens, LeadsLens, MarketLens } from '@/lib/brain/lenses';

type CoachingUnavailable = { available: false; reason: string };

type BrainResponse = {
  configured: boolean;
  migrated?: boolean;
  reason?: string;
  error?: string;
  market?: MarketLens;
  leads?: LeadsLens;
  coaching?: CoachingLens | CoachingUnavailable;
  stats?: BrainStats;
};

const bannerClass =
  'rounded-2xl border border-[rgba(122,94,32,0.3)] bg-[rgba(232,184,98,0.12)] px-4 py-3 text-sm font-medium text-[var(--brand-gold-deep)]';

function isCoachingAvailable(c: CoachingLens | CoachingUnavailable | undefined): c is CoachingLens {
  return !!c && !('available' in c && c.available === false);
}

function timeAgo(iso: string | null): string {
  if (!iso) return 'not yet';
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return 'just now';
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

function MicroLabel({ children }: { children: React.ReactNode }) {
  return <p className="text-[10.5px] font-extrabold uppercase tracking-[.18em] text-[var(--op-dim)]">{children}</p>;
}

function InsightsList({ insights }: { insights: BrainInsight[] }) {
  if (insights.length === 0) return null;
  return (
    <div>
      <MicroLabel>From the team</MicroLabel>
      <ul className="mt-1.5 flex flex-col gap-2">
        {insights.map(i => (
          <li key={i.id} className="rounded-lg border border-[var(--op-border)] bg-white/70 px-3 py-2 text-sm">
            <p className="font-semibold text-[var(--op-text)]">{i.title}</p>
            <p className="mt-0.5 text-[13px] text-[var(--op-dim)]">{i.content}</p>
            {i.verticalName && <p className="mt-1 text-xs text-[var(--brand-cream-dim)]">{i.verticalName}</p>}
          </li>
        ))}
      </ul>
    </div>
  );
}

function LensCard({
  title,
  blurb,
  headline,
  children,
}: {
  title: string;
  blurb: string;
  headline: React.ReactNode;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <li className="coach-card">
      <h3 className="text-[18px] font-bold leading-snug tracking-[-.01em] text-[var(--op-text)]">{title}</h3>
      <p className="text-[13.5px] text-[var(--op-dim)]">{blurb}</p>
      <div className="mt-1 flex flex-wrap gap-4">{headline}</div>
      <button
        onClick={() => setOpen(o => !o)}
        className="mt-1 inline-flex min-h-[40px] w-fit items-center text-xs font-bold uppercase tracking-[.14em] text-[var(--brand-gold-deep)] hover:underline"
      >
        {open ? 'Hide details' : 'Details'}
      </button>
      {open && <div className="mt-1 flex flex-col gap-4 border-t border-[var(--op-border)] pt-3">{children}</div>}
    </li>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <MicroLabel>{label}</MicroLabel>
      <div className="text-lg font-bold tabular-nums text-[var(--op-text)]">{value}</div>
    </div>
  );
}

function MarketCard({ market }: { market: MarketLens }) {
  return (
    <LensCard
      title="Market brain"
      blurb="What we know about the market and customers."
      headline={
        <>
          <Stat label="Documents" value={market.documentsTotal} />
          <Stat label="Verticals with notes" value={market.verticalNotes.length} />
          <Stat label="Top phrases" value={market.topCustomerLanguage.length} />
        </>
      }
    >
      {market.topCustomerLanguage.length > 0 && (
        <div>
          <MicroLabel>How customers talk about it</MicroLabel>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {market.topCustomerLanguage.map(p => (
              <span
                key={p.phrase}
                className="rounded-full border border-[var(--op-border-mid)] bg-white/80 px-2.5 py-1 text-xs text-[var(--op-text-2)]"
              >
                &quot;{p.phrase}&quot; <span className="text-[var(--brand-cream-dim)]">×{p.count}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {market.documentsByVertical.length > 0 && (
        <div>
          <MicroLabel>Documents by vertical</MicroLabel>
          <ul className="mt-1 flex flex-col text-sm">
            {market.documentsByVertical.map(v => (
              <li key={v.verticalId} className="flex items-center justify-between gap-3 border-t border-[var(--op-border)] py-1.5">
                <span className="text-[var(--op-text-2)]">{v.verticalName}</span>
                <span className="tabular-nums text-[var(--op-dim)]">{v.count}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {market.verticalNotes.length > 0 && (
        <div>
          <MicroLabel>Knowledge notes</MicroLabel>
          <ul className="mt-1 flex flex-col gap-2">
            {market.verticalNotes.map(n => (
              <li key={n.verticalId} className="border-t border-[var(--op-border)] pt-2 text-sm">
                <span className="font-semibold text-[var(--op-text-2)]">{n.verticalName}</span>
                <p className="mt-0.5 text-[13px] text-[var(--op-dim)]">{n.notes}</p>
              </li>
            ))}
          </ul>
        </div>
      )}

      {market.recentDocuments.length === 0 && market.verticalNotes.length === 0 && market.topCustomerLanguage.length === 0 && (
        <p className="text-sm text-[var(--op-dim)]">No market knowledge yet — upload documents or write knowledge notes on a vertical.</p>
      )}

      <InsightsList insights={market.insights} />
    </LensCard>
  );
}

function LeadsCard({ leads }: { leads: LeadsLens }) {
  const { outcomeMix } = leads;
  return (
    <LensCard
      title="Leads brain"
      blurb="What converts."
      headline={
        <>
          <Stat label="Booked" value={outcomeMix.booked} />
          <Stat label="Not booked" value={outcomeMix.notBooked} />
          <Stat label="Booked rate" value={outcomeMix.bookedRate !== null ? `${outcomeMix.bookedRate}%` : '—'} />
        </>
      }
    >
      {leads.byVertical.length > 0 && (
        <div>
          <MicroLabel>Which verticals convert best</MicroLabel>
          <ul className="mt-1 flex flex-col text-sm">
            {leads.byVertical.map(v => (
              <li key={v.verticalId} className="flex items-center justify-between gap-3 border-t border-[var(--op-border)] py-1.5">
                <span className="text-[var(--op-text-2)]">{v.verticalName}</span>
                <span className="tabular-nums text-[var(--op-dim)]">
                  {v.bookedRate !== null ? `${v.bookedRate}%` : '—'} · {v.booked}/{v.total}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {leads.topObjections.length > 0 && (
        <div>
          <MicroLabel>Top objections</MicroLabel>
          <ul className="mt-1 flex flex-col text-sm">
            {leads.topObjections.map(o => (
              <li key={o.objection} className="flex items-center justify-between gap-3 border-t border-[var(--op-border)] py-1.5">
                <span className="text-[var(--op-text-2)]">{o.objection}</span>
                <span className="tabular-nums text-[var(--op-dim)]">{o.pct}%</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {leads.byVertical.length === 0 && leads.topObjections.length === 0 && (
        <p className="text-sm text-[var(--op-dim)]">No call outcomes learned yet.</p>
      )}

      <InsightsList insights={leads.insights} />
    </LensCard>
  );
}

function CoachingCard({ coaching }: { coaching: CoachingLens | CoachingUnavailable | undefined }) {
  if (!isCoachingAvailable(coaching)) {
    return (
      <li className="coach-card">
        <h3 className="text-[18px] font-bold leading-snug tracking-[-.01em] text-[var(--op-text)]">Coaching brain</h3>
        <p className="text-[13.5px] text-[var(--op-dim)]">How the team performs.</p>
        <div className={bannerClass}>{coaching?.reason ?? 'Coaching data is not available yet.'}</div>
      </li>
    );
  }

  return (
    <LensCard
      title="Coaching brain"
      blurb="How the team performs."
      headline={
        <>
          <Stat label="Team overall" value={coaching.team.avgOverall ?? '—'} />
          <Stat label="Experience" value={coaching.team.avgExperience ?? '—'} />
          <Stat label="Calls scored" value={coaching.team.calls} />
        </>
      }
    >
      {coaching.lowestDimensions.length > 0 && (
        <div>
          <MicroLabel>Where to coach next</MicroLabel>
          <ul className="mt-1 flex flex-col text-sm">
            {coaching.lowestDimensions.map(d => (
              <li key={d.key} className="flex items-center justify-between gap-3 border-t border-[var(--op-border)] py-1.5">
                <span className="text-[var(--op-text-2)]">{d.label}</span>
                <span className="tabular-nums text-[var(--op-dim)]">{d.avgRatio}%</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {(coaching.topWhatWorked.length > 0 || coaching.topWhatFailed.length > 0) && (
        <div className="grid gap-4 sm:grid-cols-2">
          {coaching.topWhatWorked.length > 0 && (
            <div>
              <MicroLabel>What worked</MicroLabel>
              <ul className="mt-1 flex flex-col gap-1 text-sm text-[var(--op-text-2)]">
                {coaching.topWhatWorked.map(w => (
                  <li key={w.item}>{w.item}</li>
                ))}
              </ul>
            </div>
          )}
          {coaching.topWhatFailed.length > 0 && (
            <div>
              <MicroLabel>What failed</MicroLabel>
              <ul className="mt-1 flex flex-col gap-1 text-sm text-[var(--op-text-2)]">
                {coaching.topWhatFailed.map(w => (
                  <li key={w.item}>{w.item}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      <p className="text-sm text-[var(--op-dim)]">
        <span className="font-semibold text-[var(--op-text-2)]">{coaching.pendingProposals}</span> playbook proposal
        {coaching.pendingProposals === 1 ? '' : 's'} waiting for a decision.
      </p>

      <InsightsList insights={coaching.insights} />
    </LensCard>
  );
}

export default function BrainView() {
  const [data, setData] = useState<BrainResponse | null>(null);
  const [status, setStatus] = useState<'loading' | 'done' | 'error'>('loading');

  useEffect(() => {
    let cancelled = false;
    fetch('/api/brain')
      .then(res => res.json())
      .then((json: BrainResponse) => {
        if (cancelled) return;
        setData(json);
        setStatus('done');
      })
      .catch(() => {
        if (cancelled) return;
        setStatus('error');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (status === 'loading') {
    return <p className="text-sm text-[var(--op-dim)]">Loading the brain…</p>;
  }
  if (status === 'error') {
    return <p className="text-sm font-medium text-[var(--brand-red)]">Could not load the brain.</p>;
  }
  if (!data?.configured) {
    return (
      <div className={bannerClass}>
        Supabase not configured — set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, and SUPABASE_SERVICE_ROLE_KEY in
        .env.local.
      </div>
    );
  }
  if (data.migrated === false || !data.market || !data.leads || !data.stats) {
    return <div className={bannerClass}>{data.reason ?? data.error ?? 'Run the knowledge migrations (0002/0003) first.'}</div>;
  }

  const { market, leads, coaching, stats } = data;

  return (
    <div className="flex flex-col gap-8">
      <BrainHero />

      <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 rounded-2xl border border-[var(--op-border)] bg-white/70 px-5 py-4 text-center text-sm text-[var(--op-dim)]">
        <span>
          <span className="font-bold tabular-nums text-[var(--op-text)]">{stats.callsScored}</span> calls scored
        </span>
        <span>
          <span className="font-bold tabular-nums text-[var(--op-text)]">{stats.transcriptsLearned}</span> transcripts learned from
        </span>
        <span>
          Last learned <span className="font-semibold text-[var(--op-text-2)]">{timeAgo(stats.lastLearnedAt)}</span>
        </span>
      </div>

      <ul className="grid gap-4 lg:grid-cols-3">
        <MarketCard market={market} />
        <LeadsCard leads={leads} />
        <CoachingCard coaching={coaching} />
      </ul>
    </div>
  );
}

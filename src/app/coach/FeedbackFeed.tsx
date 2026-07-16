'use client';

// The rep's own feedback feed: fetches GET /api/feedback on mount, renders
// newest-first. Each card leads with the win (big, warm), then at most one
// fix block (the timestamp chip + the exact line to say next time are the
// star), with the score and every other number tucked behind a "Details"
// expander — never in the headline. Unseen cards get a small dot; opening a
// card's details for the first time stamps it seen via
// POST /api/feedback/[id]/seen.

import { useEffect, useState } from 'react';
import { feelingTier, type FeelingTier } from '@/lib/feedback/card';

type DimensionScore = { score: number; max: number; notes: string };

type CardFix = { label: string; timestamp: string | null; sayThis: string; fromTranscript: string };

type CardDetail = {
  overall: number;
  experienceScore: number;
  experience: { caredFor: number; atEase: number; excited: number; notes: string };
  emotional: { state: string; namedBack: boolean; matchedTrack: boolean; grade: number; notes: string };
  sales: { opening: DimensionScore; discovery: DimensionScore; value: DimensionScore; objections: DimensionScore; close: DimensionScore; total: number };
  hospitality: {
    greeting: DimensionScore;
    listening: DimensionScore;
    courtesy: DimensionScore;
    deadAir: DimensionScore;
    warmEnding: DimensionScore;
    total: number;
  };
  hardMetrics: {
    repTalkRatio: number;
    questionCount: number;
    deadAirSeconds: number;
    interruptionCount: number;
    durationSeconds: number;
  };
  guarantees: unknown;
};

type CardContent = { headline: string; fix: CardFix | null; detail: CardDetail };

type FeedbackCard = {
  id: string;
  praiseOnly: boolean;
  card: CardContent;
  seenAt: string | null;
  createdAt: string;
};

type FeedbackResponse = {
  configured: boolean;
  migrated?: boolean;
  reason?: string;
  cards: FeedbackCard[];
};

const amberBannerClass =
  'rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200';

function pct(score: number, max: number): string {
  return max > 0 ? `${Math.round((score / max) * 100)}%` : '—';
}

const feelingClass: Record<FeelingTier, string> = {
  positive: 'text-emerald-700 dark:text-emerald-400',
  neutral: 'text-amber-700 dark:text-amber-400',
  muted: 'text-zinc-400',
};

function Feeling({ label, value }: { label: string; value: number }) {
  return <span className={feelingClass[feelingTier(value)]}>{label} {value}/10</span>;
}

function DimensionRow({ label, dim }: { label: string; dim: DimensionScore }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1 text-sm">
      <span className="text-zinc-600 dark:text-zinc-400">{label}</span>
      <span className="text-right text-zinc-500">
        {dim.score}/{dim.max}
        {dim.notes && <span className="ml-2 text-zinc-400">({dim.notes})</span>}
      </span>
    </div>
  );
}

function CardDetails({ detail }: { detail: CardDetail }) {
  return (
    <div className="mt-3 space-y-4 border-t border-zinc-200 pt-3 text-sm dark:border-zinc-800">
      <div className="flex flex-wrap gap-4">
        <div>
          <div className="text-xs uppercase tracking-wide text-zinc-400">Overall</div>
          <div className="text-lg font-semibold">{detail.overall}</div>
        </div>
        <div>
          <div className="text-xs uppercase tracking-wide text-zinc-400">Experience</div>
          <div className="text-lg font-semibold">{detail.experienceScore}</div>
        </div>
      </div>

      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400">The signature feeling</p>
        <div className="mt-1 flex flex-wrap gap-2 text-xs">
          <Feeling label="Cared for" value={detail.experience.caredFor} />
          <Feeling label="At ease" value={detail.experience.atEase} />
          <Feeling label="Excited" value={detail.experience.excited} />
        </div>
        {detail.experience.notes && <p className="mt-1 text-xs text-zinc-500">{detail.experience.notes}</p>}
      </div>

      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Reading the customer</p>
        <p className="mt-1 text-xs text-zinc-500">
          {detail.emotional.state} · {detail.emotional.namedBack ? 'named back' : 'not named back'} ·{' '}
          {detail.emotional.matchedTrack ? 'matched track' : 'track not matched'}
        </p>
      </div>

      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Sales ({pct(detail.sales.total, 100)})</p>
        <DimensionRow label="Opening" dim={detail.sales.opening} />
        <DimensionRow label="Discovery" dim={detail.sales.discovery} />
        <DimensionRow label="Value" dim={detail.sales.value} />
        <DimensionRow label="Objections" dim={detail.sales.objections} />
        <DimensionRow label="Close" dim={detail.sales.close} />
      </div>

      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Hospitality ({pct(detail.hospitality.total, 100)})</p>
        <DimensionRow label="Greeting" dim={detail.hospitality.greeting} />
        <DimensionRow label="Listening" dim={detail.hospitality.listening} />
        <DimensionRow label="Courtesy" dim={detail.hospitality.courtesy} />
        <DimensionRow label="Dead air" dim={detail.hospitality.deadAir} />
        <DimensionRow label="Warm ending" dim={detail.hospitality.warmEnding} />
      </div>

      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Hard metrics</p>
        <p className="mt-1 text-xs text-zinc-500">
          Talk ratio {Math.round(detail.hardMetrics.repTalkRatio * 100)}% · {detail.hardMetrics.questionCount} questions ·{' '}
          {detail.hardMetrics.deadAirSeconds}s dead air · {detail.hardMetrics.interruptionCount} interruptions ·{' '}
          {Math.round(detail.hardMetrics.durationSeconds / 60)} min call
        </p>
      </div>
    </div>
  );
}

function FeedbackCardView({ item, onOpen }: { item: FeedbackCard; onOpen: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const unseen = item.seenAt === null;

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next) onOpen(item.id);
  }

  return (
    <li className="relative rounded-md border border-zinc-200 p-4 dark:border-zinc-800">
      {unseen && (
        <span
          className="absolute right-3 top-3 h-2 w-2 rounded-full bg-blue-500"
          title="New — not yet opened"
        />
      )}
      <p className="pr-6 text-base font-medium leading-snug">{item.card.headline}</p>

      {item.card.fix && (
        <div className="mt-3 rounded-md bg-zinc-50 p-3 dark:bg-zinc-900">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{item.card.fix.label}</span>
            {item.card.fix.timestamp && (
              <span className="rounded-full border border-zinc-300 px-2 py-0.5 text-xs text-zinc-500 dark:border-zinc-700">
                {item.card.fix.timestamp}
              </span>
            )}
          </div>
          <p className="mt-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100">&quot;{item.card.fix.sayThis}&quot;</p>
          <p className="mt-1 text-xs text-zinc-500">From the call: &quot;{item.card.fix.fromTranscript}&quot;</p>
        </div>
      )}

      <button onClick={toggle} className="mt-3 text-xs text-zinc-500 hover:underline">
        {open ? 'Hide details' : 'Details'}
      </button>

      {open && <CardDetails detail={item.card.detail} />}
    </li>
  );
}

export default function FeedbackFeed() {
  const [cards, setCards] = useState<FeedbackCard[]>([]);
  const [migrated, setMigrated] = useState(true);
  const [reason, setReason] = useState<string | null>(null);
  const [status, setStatus] = useState<'loading' | 'done' | 'error'>('loading');

  useEffect(() => {
    let cancelled = false;
    fetch('/api/feedback')
      .then(res => res.json())
      .then((json: FeedbackResponse) => {
        if (cancelled) return;
        setMigrated(json.migrated !== false);
        setReason(json.reason ?? null);
        setCards(json.cards ?? []);
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

  function markSeen(id: string) {
    setCards(prev => prev.map(c => (c.id === id && c.seenAt === null ? { ...c, seenAt: new Date().toISOString() } : c)));
    fetch(`/api/feedback/${id}/seen`, { method: 'POST' }).catch(() => {});
  }

  return (
    <div className="flex flex-col gap-4">
      {!migrated && <div className={amberBannerClass}>{reason ?? 'Run migration 0008 first.'}</div>}
      {migrated && reason && <div className={amberBannerClass}>{reason}</div>}

      {status === 'loading' && <p className="text-sm text-zinc-500">Loading…</p>}
      {status === 'error' && <p className="text-sm text-red-600 dark:text-red-400">Could not load your feedback.</p>}

      {status === 'done' && migrated && cards.length === 0 && (
        <p className="text-sm text-zinc-500">No scored calls yet. Cards appear here a few minutes after each call.</p>
      )}

      {cards.length > 0 && (
        <ul className="flex flex-col gap-3">
          {cards.map(item => (
            <FeedbackCardView key={item.id} item={item} onOpen={markSeen} />
          ))}
        </ul>
      )}
    </div>
  );
}

'use client';

// The rep's own feedback feed: fetches GET /api/feedback on mount, renders
// newest-first. Each card leads with the win (big, warm), then at most one
// fix block (the timestamp chip + the exact line to say next time are the
// star), with the score and every other number tucked behind a "Details"
// expander — never in the headline. Unseen cards get a small dot; opening a
// card's details for the first time stamps it seen via
// POST /api/feedback/[id]/seen.
//
// Styling: quote-tool brand tokens from globals.css (PR 1 of 3, see that
// file's "coach theme match" comment block). The .coach-card / .coach-cue /
// .coach-praise-pill classes hold the pieces that need a pseudo-element,
// gradient wash, or keyframe; everything else is a Tailwind arbitrary value
// against the same CSS variables.

import { useEffect, useState } from 'react';
import { bannerClass, CardDetails, CardWinBlock, type CardContent } from './CardSections';

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

function FeedbackCardView({ item, onOpen }: { item: FeedbackCard; onOpen: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const unseen = item.seenAt === null;

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next) onOpen(item.id);
  }

  return (
    <li className={`coach-card ${item.praiseOnly ? 'coach-card--gold' : ''}`}>
      {unseen && (
        <span
          className="absolute right-4 top-4 h-2.5 w-2.5 rounded-full bg-[var(--brand-gold-bright)] shadow-[0_0_0_4px_rgba(232,184,98,0.25)]"
          title="New — not yet opened"
        />
      )}

      <CardWinBlock headline={item.card.headline} fix={item.card.fix} praiseOnly={item.praiseOnly} />

      <button
        onClick={toggle}
        className="mt-1 inline-flex min-h-[40px] w-fit items-center text-xs font-bold uppercase tracking-[.14em] text-[var(--brand-gold-deep)] hover:underline"
      >
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
      {!migrated && <div className={bannerClass}>{reason ?? 'Run migration 0008 first.'}</div>}
      {migrated && reason && <div className={bannerClass}>{reason}</div>}

      {status === 'loading' && <p className="text-sm text-[var(--op-dim)]">Loading…</p>}
      {status === 'error' && <p className="text-sm font-medium text-[var(--brand-red)]">Could not load your feedback.</p>}

      {status === 'done' && migrated && cards.length === 0 && (
        <p className="text-sm text-[var(--op-dim)]">No scored calls yet. Cards appear here a few minutes after each call.</p>
      )}

      {cards.length > 0 && (
        <ul className="flex flex-col gap-3.5">
          {cards.map(item => (
            <FeedbackCardView key={item.id} item={item} onOpen={markSeen} />
          ))}
        </ul>
      )}
    </div>
  );
}

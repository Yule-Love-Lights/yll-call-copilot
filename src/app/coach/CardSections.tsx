'use client';

// Shared card-visual pieces, factored out of FeedbackFeed.tsx (the rep's
// feedback feed) so /practice's result card can reuse the exact same
// win-first, one-fix, numbers-tucked, brand-family look instead of
// re-implementing it. FeedbackFeed still owns the unseen dot + seen-on-open
// persistence (feed-specific); this module owns everything about how one
// score renders.

import { feelingTier, type FeelingTier } from '@/lib/feedback/card';
import { formatOverallExact } from '@/lib/formatScore';

export type DimensionScore = { score: number; max: number; notes: string };

export type CardFix = { label: string; timestamp: string | null; sayThis: string; fromTranscript: string };

// One guarantee's grade for a call, e.g. { applicable: true, done: false,
// notes: '...' } -- mirrors the shape CallBrowser.tsx already assumes for
// this same jsonb column (src/app/coach/calls/CallBrowser.tsx's
// GuaranteeGrade).
export type GuaranteeGrade = { applicable: boolean; done: boolean; notes: string };
export type Guarantees = Record<string, GuaranteeGrade> | null;

export type CardDetail = {
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
  guarantees: Guarantees;
};

export type CardContent = { headline: string; fix: CardFix | null; detail: CardDetail };

// Label map for the seven guarantee keys, matching the call browser's
// applicable-only / done-vs-missed semantics (src/app/coach/calls/CallBrowser.tsx).
export const GUARANTEE_LABELS: Record<string, string> = {
  fast_fix_48h: '48-hour fast fix',
  all_inclusive: 'All-inclusive line',
  lease_disclosure: 'Lease disclosure',
  labor_warranty_3yr: '3-year labor warranty',
  referral_ask: 'Referral ask',
  rebook_lock: 'Rebook lock',
  permanent_seed: 'Permanent seed',
};

export const bannerClass =
  'rounded-2xl border border-[rgba(122,94,32,0.3)] bg-[rgba(232,184,98,0.12)] px-4 py-3 text-sm font-medium text-[var(--brand-gold-deep)]';

export function pct(score: number, max: number): string {
  return max > 0 ? `${Math.round((score / max) * 100)}%` : '—';
}

const feelingClass: Record<FeelingTier, string> = {
  positive: 'text-[var(--brand-gold-deep)]',
  neutral: 'text-[var(--op-dim)]',
  muted: 'text-[var(--brand-cream-dim)]',
};

export function Feeling({ label, value }: { label: string; value: number }) {
  return (
    <span className={feelingClass[feelingTier(value)]}>
      {label} <span className="tabular-nums">{value}/10</span>
    </span>
  );
}

export function DimensionRow({ label, dim }: { label: string; dim: DimensionScore }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1 text-sm">
      <span className="text-[var(--op-text-2)]">{label}</span>
      <span className="text-right text-[var(--op-dim)]">
        <span className="tabular-nums">
          {dim.score}/{dim.max}
        </span>
        {dim.notes && <span className="ml-2 text-[var(--brand-cream-dim)]">({dim.notes})</span>}
      </span>
    </div>
  );
}

export function MicroLabel({ children }: { children: React.ReactNode }) {
  return <p className="text-[10.5px] font-extrabold uppercase tracking-[.18em] text-[var(--op-dim)]">{children}</p>;
}

// Applicable-only guarantees checklist. Renders nothing when the card
// carries no guarantees jsonb (older cards) or none apply to this call.
export function GuaranteesChecklist({ guarantees }: { guarantees: Guarantees }) {
  const applicable = Object.entries(guarantees ?? {}).filter(([, g]) => g.applicable);
  if (applicable.length === 0) return null;

  return (
    <div>
      <MicroLabel>Guarantees said</MicroLabel>
      <ul className="mt-1 flex flex-col text-sm">
        {applicable.map(([key, g]) => (
          <li key={key} className="flex flex-col gap-0.5 border-t border-[var(--op-border)] py-1.5">
            <div className="flex items-center justify-between gap-3">
              <span className="text-[var(--op-text-2)]">{GUARANTEE_LABELS[key] ?? key}</span>
              <span className={g.done ? 'font-semibold text-[var(--brand-evergreen-3)]' : 'font-semibold text-[var(--brand-gold-deep)]'}>
                {g.done ? 'done' : 'missed'}
              </span>
            </div>
            {g.notes && <span className="text-xs text-[var(--brand-cream-dim)]">{g.notes}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function CardDetails({ detail }: { detail: CardDetail }) {
  return (
    <div className="mt-1 flex flex-col gap-4 border-t border-[var(--op-border)] pt-3 text-sm">
      <div className="flex flex-wrap gap-4">
        <div>
          <MicroLabel>Overall</MicroLabel>
          <div className="text-lg font-bold tabular-nums text-[var(--op-text)]">{formatOverallExact(detail.overall)}</div>
        </div>
        <div>
          <MicroLabel>Experience</MicroLabel>
          <div className="text-lg font-bold tabular-nums text-[var(--op-text)]">{detail.experienceScore}</div>
        </div>
      </div>

      <div>
        <MicroLabel>The signature feeling</MicroLabel>
        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs">
          <Feeling label="Cared for" value={detail.experience.caredFor} />
          <Feeling label="At ease" value={detail.experience.atEase} />
          <Feeling label="Excited" value={detail.experience.excited} />
        </div>
        {detail.experience.notes && <p className="mt-1 text-xs text-[var(--op-dim)]">{detail.experience.notes}</p>}
      </div>

      <div>
        <MicroLabel>Reading the customer</MicroLabel>
        <p className="mt-1 text-xs text-[var(--op-dim)]">
          {detail.emotional.state} · {detail.emotional.namedBack ? 'named back' : 'not named back'} ·{' '}
          {detail.emotional.matchedTrack ? 'matched track' : 'track not matched'}
        </p>
      </div>

      <div>
        <MicroLabel>Sales ({pct(detail.sales.total, 100)})</MicroLabel>
        <DimensionRow label="Opening" dim={detail.sales.opening} />
        <DimensionRow label="Discovery" dim={detail.sales.discovery} />
        <DimensionRow label="Value" dim={detail.sales.value} />
        <DimensionRow label="Objections" dim={detail.sales.objections} />
        <DimensionRow label="Close" dim={detail.sales.close} />
      </div>

      <div>
        <MicroLabel>Hospitality ({pct(detail.hospitality.total, 100)})</MicroLabel>
        <DimensionRow label="Greeting" dim={detail.hospitality.greeting} />
        <DimensionRow label="Listening" dim={detail.hospitality.listening} />
        <DimensionRow label="Courtesy" dim={detail.hospitality.courtesy} />
        <DimensionRow label="Dead air" dim={detail.hospitality.deadAir} />
        <DimensionRow label="Warm ending" dim={detail.hospitality.warmEnding} />
      </div>

      <GuaranteesChecklist guarantees={detail.guarantees} />

      <div>
        <MicroLabel>Hard metrics</MicroLabel>
        <p className="mt-1 text-xs text-[var(--op-dim)]">
          Talk ratio <span className="tabular-nums">{Math.round(detail.hardMetrics.repTalkRatio * 100)}%</span> ·{' '}
          <span className="tabular-nums">{detail.hardMetrics.questionCount}</span> questions ·{' '}
          <span className="tabular-nums">{detail.hardMetrics.deadAirSeconds}s</span> dead air ·{' '}
          <span className="tabular-nums">{detail.hardMetrics.interruptionCount}</span> interruptions ·{' '}
          <span className="tabular-nums">{Math.round(detail.hardMetrics.durationSeconds / 60)} min</span> call
        </p>
      </div>
    </div>
  );
}

// The win-first headline + at-most-one-fix block, shared between the feed
// (FeedbackFeed.tsx, wrapped in its own unseen-dot li) and the practice
// result card (PracticeRoom.tsx, no seen-state to track).
export function CardWinBlock({ headline, fix, praiseOnly }: { headline: string; fix: CardFix | null; praiseOnly: boolean }) {
  return (
    <>
      {praiseOnly && (
        <span className="coach-praise-pill inline-flex w-fit items-center gap-1.5 self-start rounded-full bg-gradient-to-r from-[var(--brand-gold)] to-[var(--brand-gold-bright)] px-3 py-1 text-[11.5px] font-extrabold uppercase tracking-[.1em] text-[var(--brand-evergreen)] shadow-[0_2px_10px_rgba(232,184,98,0.45)]">
          Nothing to fix
        </span>
      )}

      <h3 className="pr-6 text-[18px] font-bold leading-snug tracking-[-.01em] text-[var(--op-text)]">{headline}</h3>

      {fix && (
        <div className="coach-cue">
          <span className="text-[10.5px] font-extrabold uppercase tracking-[.18em] text-[var(--brand-red)]">Say this next time</span>
          <p className="ml-1.5 mt-1.5 text-[14.5px] text-[var(--op-text)]">&quot;{fix.sayThis}&quot;</p>
          {fix.timestamp && (
            <span className="ml-1.5 mt-2 inline-block rounded-full border border-[var(--op-border-mid)] bg-white/80 px-2.5 py-0.5 text-[11.5px] font-semibold tabular-nums text-[var(--op-dim)]">
              at {fix.timestamp}
            </span>
          )}
          <p className="ml-1.5 mt-2 text-xs text-[var(--op-dim)]">From the call: &quot;{fix.fromTranscript}&quot;</p>
        </div>
      )}
    </>
  );
}

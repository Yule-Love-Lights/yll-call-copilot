'use client';

// The call-review browser: a list of scored calls on the left, the selected
// call's transcript and full scorecard on the right (stacked on small
// screens). Talks to GET /api/coach/calls (paged with ?limit=/&before=) and
// GET /api/coach/calls/[id]. A rep gets the same friendly 403 handling as
// /digest -- this is coaching prep for a one-on-one, never a rep-facing
// page.

import { useCallback, useEffect, useState } from 'react';
import { splitRawTextIntoTurns } from '@/lib/coachCalls/turns';

type CallListItem = {
  id: string;
  transcript_id: string;
  rep_email: string | null;
  vertical_slug: string | null;
  called_at: string | null;
  scored_at: string;
  overall: number;
  experience_score: number;
  praise_only: boolean;
  customer_name: string | null;
  duration_seconds: number | null;
  outcome: string;
};

type CallsListResponse = {
  configured: boolean;
  migrated?: boolean;
  reason?: string;
  error?: string;
  calls?: CallListItem[];
};

type Dim = { score: number; max: number; notes: string };
type GuaranteeGrade = { applicable: boolean; done: boolean; notes: string };
type Fix = { moment: string; timestamp_seconds: number | null; transcript_quote: string; better_line: string } | null;

type CallDetail = {
  id: string;
  transcript_id: string;
  rubric_version: number;
  rep_email: string | null;
  vertical_slug: string | null;
  called_at: string | null;
  scored_at: string;
  emotional: { state: string; named_back: boolean; matched_track: boolean; grade: number; notes: string };
  sales: { opening: Dim; discovery: Dim; value: Dim; objections: Dim; close: Dim; total: number };
  hospitality: { greeting: Dim; listening: Dim; courtesy: Dim; dead_air: Dim; warm_ending: Dim; total: number };
  hard_metrics: { rep_talk_ratio: number; question_count: number; dead_air_seconds: number; interruption_count: number; duration_seconds: number };
  experience: { cared_for: number; at_ease: number; excited: number; notes: string };
  experience_score: number;
  guarantees: Record<string, GuaranteeGrade> | null;
  overall: number;
  win: string;
  fix: Fix;
};

type TranscriptDetail = {
  raw_text: string;
  customer_name: string | null;
  outcome: string | null;
  duration_seconds: number | null;
  called_at: string | null;
};

type CallDetailResponse = {
  configured: boolean;
  error?: string;
  call?: CallDetail;
  transcript?: TranscriptDetail | null;
};

const LIST_LIMIT = 50;

const GUARANTEE_LABELS: Record<string, string> = {
  fast_fix_48h: '48-hour fast-fix guarantee',
  all_inclusive: 'All-inclusive pricing line',
  lease_disclosure: 'Lease disclosure',
  labor_warranty_3yr: '3-year labor warranty',
  referral_ask: 'Referral ask',
  rebook_lock: 'Rebook lock',
  permanent_seed: 'Permanent-lighting seed',
};

const amberBannerClass =
  'rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200';
const cardClass = 'flex flex-col gap-3 rounded-md border border-zinc-200 p-4 dark:border-zinc-800';

function formatDate(iso: string | null): string {
  if (!iso) return 'no call time';
  return new Date(iso).toLocaleString();
}

function formatDuration(seconds: number | null): string {
  if (seconds == null) return '—';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function pct(score: number, max: number): string {
  return max > 0 ? `${Math.round((score / max) * 100)}%` : '—';
}

function yesNo(value: boolean): string {
  return value ? 'yes' : 'no';
}

function CallRow({ item, selected, onSelect }: { item: CallListItem; selected: boolean; onSelect: () => void }) {
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        className={`flex w-full flex-col gap-1 rounded-md border px-3 py-2 text-left text-sm ${
          selected
            ? 'border-zinc-900 bg-zinc-50 dark:border-zinc-100 dark:bg-zinc-900'
            : 'border-transparent hover:bg-zinc-50 dark:hover:bg-zinc-900'
        }`}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="font-medium">{item.customer_name ?? 'Unknown customer'}</span>
          <span
            className={`h-2 w-2 shrink-0 rounded-full ${item.praise_only ? 'bg-emerald-500' : 'bg-amber-500'}`}
            title={item.praise_only ? 'Praise only, no fix on this call' : 'Has a fix moment to review'}
          />
        </div>
        <span className="text-xs text-zinc-500">
          {item.rep_email ?? 'unknown rep'} · {formatDate(item.called_at)}
        </span>
        <div className="flex items-center gap-2 text-xs text-zinc-500">
          <span>{formatDuration(item.duration_seconds)}</span>
          {item.outcome !== 'unknown' && (
            <span className="rounded-full border border-zinc-300 px-2 py-0.5 dark:border-zinc-700">{item.outcome}</span>
          )}
          <span className="ml-auto">overall {item.overall}</span>
        </div>
      </button>
    </li>
  );
}

function DimensionRow({ label, dim }: { label: string; dim: Dim }) {
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

function TranscriptPane({ rawText }: { rawText: string }) {
  const turns = splitRawTextIntoTurns(rawText);

  return (
    <div className={cardClass}>
      <h2 className="text-sm font-semibold">Transcript</h2>
      <div className="max-h-[70vh] overflow-y-auto pr-1">
        {turns.length === 0 ? (
          <p className="text-sm text-zinc-500">No transcript text.</p>
        ) : (
          <div className="flex flex-col gap-3 text-sm">
            {turns.map((turn, i) => (
              <p key={i}>
                {turn.speaker && <span className="font-semibold">{turn.speaker}: </span>}
                <span className="text-zinc-700 dark:text-zinc-300">{turn.text}</span>
              </p>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Scorecard({ call }: { call: CallDetail }) {
  const applicableGuarantees = Object.entries(call.guarantees ?? {}).filter(([, g]) => g.applicable);

  return (
    <div className="flex flex-col gap-4">
      <div className={cardClass}>
        <div className="flex flex-wrap gap-4">
          <div>
            <div className="text-xs uppercase tracking-wide text-zinc-400">Overall</div>
            <div className="text-lg font-semibold">{call.overall}</div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-zinc-400">Experience</div>
            <div className="text-lg font-semibold">{call.experience_score}</div>
          </div>
        </div>
        <p className="rounded-md bg-zinc-50 p-3 text-sm dark:bg-zinc-900">
          <span className="font-medium">Win: </span>
          {call.win}
        </p>
      </div>

      <div className={cardClass}>
        <h2 className="text-sm font-semibold">Reading the customer</h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          {call.emotional.state} · named back: {yesNo(call.emotional.named_back)} · matched track: {yesNo(call.emotional.matched_track)} ·{' '}
          grade {call.emotional.grade}/10
        </p>
        {call.emotional.notes && <p className="text-xs text-zinc-500">{call.emotional.notes}</p>}
      </div>

      <div className={cardClass}>
        <h2 className="text-sm font-semibold">Sales ({pct(call.sales.total, 100)})</h2>
        <DimensionRow label="Opening" dim={call.sales.opening} />
        <DimensionRow label="Discovery" dim={call.sales.discovery} />
        <DimensionRow label="Value" dim={call.sales.value} />
        <DimensionRow label="Objections" dim={call.sales.objections} />
        <DimensionRow label="Close" dim={call.sales.close} />
      </div>

      <div className={cardClass}>
        <h2 className="text-sm font-semibold">Hospitality ({pct(call.hospitality.total, 100)})</h2>
        <DimensionRow label="Greeting" dim={call.hospitality.greeting} />
        <DimensionRow label="Listening" dim={call.hospitality.listening} />
        <DimensionRow label="Courtesy" dim={call.hospitality.courtesy} />
        <DimensionRow label="Dead air" dim={call.hospitality.dead_air} />
        <DimensionRow label="Warm ending" dim={call.hospitality.warm_ending} />
      </div>

      <div className={cardClass}>
        <h2 className="text-sm font-semibold">Hard metrics</h2>
        <p className="text-sm text-zinc-500">
          Talk ratio {Math.round(call.hard_metrics.rep_talk_ratio * 100)}% · {call.hard_metrics.question_count} questions ·{' '}
          {call.hard_metrics.dead_air_seconds}s dead air · {call.hard_metrics.interruption_count} interruptions ·{' '}
          {formatDuration(call.hard_metrics.duration_seconds)} call
        </p>
      </div>

      <div className={cardClass}>
        <h2 className="text-sm font-semibold">The signature feeling</h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Cared for {call.experience.cared_for}/10 · At ease {call.experience.at_ease}/10 · Excited {call.experience.excited}/10
        </p>
        {call.experience.notes && <p className="text-xs text-zinc-500">{call.experience.notes}</p>}
      </div>

      {applicableGuarantees.length > 0 && (
        <div className={cardClass}>
          <h2 className="text-sm font-semibold">Guarantees said</h2>
          <ul className="flex flex-col gap-1 text-sm">
            {applicableGuarantees.map(([key, g]) => (
              <li key={key} className="flex flex-col gap-0.5 border-t border-zinc-100 py-1 dark:border-zinc-900">
                <div className="flex items-center justify-between">
                  <span>{GUARANTEE_LABELS[key] ?? key}</span>
                  <span className={g.done ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-700 dark:text-amber-400'}>
                    {g.done ? 'done' : 'missed'}
                  </span>
                </div>
                {g.notes && <span className="text-xs text-zinc-500">{g.notes}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {call.fix && (
        <div className={cardClass}>
          <h2 className="text-sm font-semibold">Worth practicing</h2>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-zinc-700 dark:text-zinc-300">{call.fix.moment}</span>
            {call.fix.timestamp_seconds != null && (
              <span className="rounded-full border border-zinc-300 px-2 py-0.5 text-xs text-zinc-500 dark:border-zinc-700">
                {formatDuration(call.fix.timestamp_seconds)}
              </span>
            )}
          </div>
          <p className="text-sm italic">&quot;{call.fix.transcript_quote}&quot;</p>
          <p className="text-sm">
            <span className="font-medium">Next time: </span>
            {call.fix.better_line}
          </p>
        </div>
      )}
    </div>
  );
}

export default function CallBrowser() {
  const [calls, setCalls] = useState<CallListItem[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [migrated, setMigrated] = useState(true);
  const [reason, setReason] = useState<string | null>(null);
  const [listStatus, setListStatus] = useState<'loading' | 'done' | 'error' | 'forbidden'>('loading');

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<CallDetailResponse | null>(null);
  const [detailStatus, setDetailStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');

  const loadCalls = useCallback((before?: string) => {
    const url = before ? `/api/coach/calls?limit=${LIST_LIMIT}&before=${encodeURIComponent(before)}` : `/api/coach/calls?limit=${LIST_LIMIT}`;
    return fetch(url)
      .then(async res => {
        if (res.status === 403) {
          setListStatus('forbidden');
          return;
        }
        const json: CallsListResponse = await res.json();
        setMigrated(json.migrated !== false);
        setReason(json.reason ?? json.error ?? null);
        const page = json.calls ?? [];
        setCalls(prev => (before ? [...prev, ...page] : page));
        setHasMore(page.length === LIST_LIMIT);
        setListStatus('done');
      })
      .catch(() => setListStatus('error'));
  }, []);

  useEffect(() => {
    loadCalls();
  }, [loadCalls]);

  async function onLoadMore() {
    if (calls.length === 0) return;
    setLoadingMore(true);
    try {
      await loadCalls(calls[calls.length - 1].scored_at);
    } finally {
      setLoadingMore(false);
    }
  }

  function onSelect(id: string) {
    setSelectedId(id);
    setDetailStatus('loading');
    fetch(`/api/coach/calls/${id}`)
      .then(async res => {
        const json: CallDetailResponse = await res.json();
        setDetail(json);
        setDetailStatus(res.ok ? 'done' : 'error');
      })
      .catch(() => setDetailStatus('error'));
  }

  if (listStatus === 'forbidden') {
    return <div className={amberBannerClass}>Call review is for the coach&apos;s one-on-one prep, not a rep-facing page.</div>;
  }

  return (
    <div className="flex flex-col gap-6 lg:flex-row">
      <div className="flex w-full flex-col gap-2 lg:w-80 lg:shrink-0">
        {!migrated && <div className={amberBannerClass}>{reason ?? 'Run migration 0008 first.'}</div>}
        {migrated && reason && <div className={amberBannerClass}>{reason}</div>}

        {listStatus === 'loading' && <p className="text-sm text-zinc-500">Loading…</p>}
        {listStatus === 'error' && <p className="text-sm text-red-600 dark:text-red-400">Could not load calls.</p>}

        {listStatus === 'done' && migrated && calls.length === 0 && <p className="text-sm text-zinc-500">No scored calls yet.</p>}

        {calls.length > 0 && (
          <ul className="flex max-h-[80vh] flex-col gap-1 overflow-y-auto pr-1">
            {calls.map(item => (
              <CallRow key={item.id} item={item} selected={item.id === selectedId} onSelect={() => onSelect(item.id)} />
            ))}
          </ul>
        )}

        {hasMore && (
          <button
            type="button"
            onClick={onLoadMore}
            disabled={loadingMore}
            className="self-start text-sm text-blue-600 hover:underline disabled:opacity-50 dark:text-blue-400"
          >
            {loadingMore ? 'Loading…' : 'Load more'}
          </button>
        )}
      </div>

      <div className="min-w-0 flex-1">
        {!selectedId && <p className="text-sm text-zinc-500">Pick a call on the left to see the transcript and scorecard.</p>}
        {selectedId && detailStatus === 'loading' && <p className="text-sm text-zinc-500">Loading…</p>}
        {selectedId && detailStatus === 'error' && <p className="text-sm text-red-600 dark:text-red-400">{detail?.error ?? 'Could not load this call.'}</p>}

        {selectedId && detailStatus === 'done' && detail?.call && (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <TranscriptPane rawText={detail.transcript?.raw_text ?? ''} />
            <Scorecard call={detail.call} />
          </div>
        )}
      </div>
    </div>
  );
}

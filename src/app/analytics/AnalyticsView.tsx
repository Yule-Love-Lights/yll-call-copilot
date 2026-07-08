'use client';

// The /analytics workspace: vertical + date-range picker, stat tiles, the
// outcome-by-opener and playbook-version win-rate tables, a plain-divs
// calls/day trend, and the compounding brain's latest narrative for the
// selected vertical with a "Run weekly review" button. Talks to
// GET /api/analytics and GET/POST /api/verticals/[id]/brain-review.

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

type VerticalOption = { id: string; slug: string; name: string };

type OpenerStat = { openerHint: string; calls: number; interested: number; interestedRate: number };
type VersionStat = { version: number; calls: number; interested: number; interestedRate: number };
type TrendPoint = { date: string; calls: number };

type Stats = {
  totalCalls: number;
  connectRate: number;
  interestedRate: number;
  followupsSent: number;
  coaching: { helpful: number; noise: number; helpfulRate: number };
  byOpener: OpenerStat[];
  byVersion: VersionStat[];
  trend: TrendPoint[];
};

type AnalyticsResponse = {
  configured: boolean;
  migrated?: boolean;
  reason?: string;
  error?: string;
  stats?: Stats;
};

type LatestReview = {
  narrative: string;
  periodStart: string;
  periodEnd: string;
  proposalsCreated: number;
  createdAt: string;
} | null;

const cardClass = 'flex flex-col gap-3 rounded-md border border-zinc-200 p-4 dark:border-zinc-800';
const primaryButtonClass =
  'rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300';
const selectClass = 'rounded-md border border-zinc-300 px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900';
const inputClass = 'rounded-md border border-zinc-300 px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900';
const amberBannerClass =
  'rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200';

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}
function daysAgoStr(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
      <span className="text-xs font-medium uppercase text-zinc-500">{label}</span>
      <span className="text-2xl font-semibold">{value}</span>
    </div>
  );
}

// Plain divs, no chart library, per the brief: a bar per day scaled to the
// range's busiest day, with the exact count on hover.
function TrendChart({ trend }: { trend: TrendPoint[] }) {
  if (trend.length === 0) return null;
  const max = Math.max(1, ...trend.map(t => t.calls));
  return (
    <div className="flex h-24 items-end gap-1 overflow-x-auto">
      {trend.map(t => (
        <div
          key={t.date}
          className="flex h-full min-w-[6px] flex-1 flex-col justify-end"
          title={`${t.date}: ${t.calls} call${t.calls === 1 ? '' : 's'}`}
        >
          <div className="w-full rounded-t bg-zinc-700 dark:bg-zinc-300" style={{ height: `${Math.max(2, (t.calls / max) * 100)}%` }} />
        </div>
      ))}
    </div>
  );
}

export default function AnalyticsView() {
  const [verticals, setVerticals] = useState<VerticalOption[]>([]);
  const [verticalsLoaded, setVerticalsLoaded] = useState(false);
  const [verticalId, setVerticalId] = useState('');
  const [from, setFrom] = useState(() => daysAgoStr(30));
  const [to, setTo] = useState(() => todayStr());

  const [data, setData] = useState<AnalyticsResponse | null>(null);
  const [status, setStatus] = useState<'loading' | 'done' | 'error'>('loading');

  const [latestReview, setLatestReview] = useState<LatestReview>(null);
  const [runningReview, setRunningReview] = useState(false);
  const [reviewMessage, setReviewMessage] = useState<string | null>(null);

  // Verticals list, loaded once. Defaults the picker to the first one
  // (creation order, from GET /api/verticals) — this app has no separate
  // "current vertical" concept anywhere else to default to instead.
  useEffect(() => {
    fetch('/api/verticals')
      .then(res => res.json())
      .then(json => {
        const list = (json.verticals ?? []) as VerticalOption[];
        setVerticals(list);
        setVerticalId(prev => prev || list[0]?.id || '');
      })
      .finally(() => setVerticalsLoaded(true));
  }, []);

  // Not an async function called directly from useEffect — every setState
  // call lives inside a .then()/.catch() callback, same convention as
  // CallConsole/VerticalDetail's load() (react-hooks/set-state-in-effect).
  // The "loading" flip on a picker change happens in the onChange handlers
  // below instead, since those run outside the effect body.
  const load = useCallback(() => {
    if (!verticalId) return Promise.resolve();
    const params = new URLSearchParams({ vertical: verticalId, from, to });
    return Promise.all([
      fetch(`/api/analytics?${params}`).then(res => res.json()),
      fetch(`/api/verticals/${verticalId}/brain-review`).then(res => res.json()),
    ])
      .then(([statsJson, reviewJson]: [AnalyticsResponse, { latest: LatestReview }]) => {
        setData(statsJson);
        setLatestReview(reviewJson.latest ?? null);
        setStatus('done');
      })
      .catch(() => setStatus('error'));
  }, [verticalId, from, to]);

  useEffect(() => {
    load();
  }, [load]);

  async function onRunReview() {
    if (!verticalId) return;
    setRunningReview(true);
    setReviewMessage(null);
    try {
      const res = await fetch(`/api/verticals/${verticalId}/brain-review`, { method: 'POST' });
      const json = await res.json();
      if (!json.reviewed) {
        setReviewMessage(json.reason ?? 'Could not run the review.');
        return;
      }
      setLatestReview(json.review);
      setReviewMessage(
        json.review.proposalsCreated > 0
          ? `Review complete. Proposed ${json.review.proposalsCreated} update${json.review.proposalsCreated === 1 ? '' : 's'}.`
          : 'Review complete. No new updates proposed.',
      );
    } finally {
      setRunningReview(false);
    }
  }

  const selectedVertical = verticals.find(v => v.id === verticalId) ?? null;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm text-zinc-500">
          Vertical
          <select
            value={verticalId}
            onChange={e => {
              setStatus('loading');
              setVerticalId(e.target.value);
            }}
            className={selectClass}
          >
            {verticals.map(v => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm text-zinc-500">
          From
          <input
            type="date"
            value={from}
            onChange={e => {
              setStatus('loading');
              setFrom(e.target.value);
            }}
            className={inputClass}
          />
        </label>
        <label className="flex items-center gap-2 text-sm text-zinc-500">
          To
          <input
            type="date"
            value={to}
            onChange={e => {
              setStatus('loading');
              setTo(e.target.value);
            }}
            className={inputClass}
          />
        </label>
      </div>

      {verticalsLoaded && verticals.length === 0 && (
        <p className="text-sm text-zinc-500">
          No verticals yet —{' '}
          <Link href="/verticals" className="text-blue-600 hover:underline dark:text-blue-400">
            create one
          </Link>{' '}
          first.
        </p>
      )}

      {status === 'loading' && verticalId && <p className="text-sm text-zinc-500">Loading…</p>}
      {status === 'error' && <p className="text-sm text-red-600 dark:text-red-400">Could not load analytics.</p>}

      {data?.migrated === false && <div className={amberBannerClass}>{data.reason}</div>}
      {data?.error && <div className={amberBannerClass}>{data.error}</div>}

      {data?.stats && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            <StatTile label="Calls" value={String(data.stats.totalCalls)} />
            <StatTile label="Connect %" value={`${data.stats.connectRate}%`} />
            <StatTile label="Interested %" value={`${data.stats.interestedRate}%`} />
            <StatTile label="Follow-ups sent" value={String(data.stats.followupsSent)} />
            <StatTile label="Coaching helpful %" value={`${data.stats.coaching.helpfulRate}%`} />
          </div>

          <div className={cardClass}>
            <h2 className="text-sm font-semibold">Calls per day</h2>
            <TrendChart trend={data.stats.trend} />
          </div>

          <div className={cardClass}>
            <h2 className="text-sm font-semibold">Outcome by opener</h2>
            {data.stats.byOpener.length === 0 ? (
              <p className="text-sm text-zinc-500">No calls in this range.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-max text-sm">
                  <thead>
                    <tr className="text-left text-zinc-500">
                      <th className="pr-4 font-medium">Opener</th>
                      <th className="pr-4 font-medium">Calls</th>
                      <th className="font-medium">Interested %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.stats.byOpener.map(o => (
                      <tr key={o.openerHint} className="border-t border-zinc-100 dark:border-zinc-900">
                        <td className="py-1 pr-4">{o.openerHint}</td>
                        <td className="py-1 pr-4">{o.calls}</td>
                        <td className="py-1">{o.interestedRate}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className={cardClass}>
            <h2 className="text-sm font-semibold">Win rate by playbook version</h2>
            {data.stats.byVersion.length === 0 ? (
              <p className="text-sm text-zinc-500">No calls in this range are attributable to a playbook version.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-max text-sm">
                  <thead>
                    <tr className="text-left text-zinc-500">
                      <th className="pr-4 font-medium">Version</th>
                      <th className="pr-4 font-medium">Calls</th>
                      <th className="font-medium">Interested %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.stats.byVersion.map(v => (
                      <tr key={v.version} className="border-t border-zinc-100 dark:border-zinc-900">
                        <td className="py-1 pr-4">v{v.version}</td>
                        <td className="py-1 pr-4">{v.calls}</td>
                        <td className="py-1">{v.interestedRate}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      <div className={cardClass}>
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Compounding brain</h2>
          {selectedVertical && (
            <Link
              href={`/verticals/${selectedVertical.id}#proposals`}
              className="text-sm text-blue-600 hover:underline dark:text-blue-400"
            >
              View proposals →
            </Link>
          )}
        </div>
        {latestReview ? (
          <div className="flex flex-col gap-1">
            <p className="text-sm">{latestReview.narrative}</p>
            <p className="text-xs text-zinc-500">
              {latestReview.periodStart} to {latestReview.periodEnd} · {new Date(latestReview.createdAt).toLocaleString()}
            </p>
          </div>
        ) : (
          <p className="text-sm text-zinc-500">No review yet for this vertical.</p>
        )}
        <button onClick={onRunReview} disabled={runningReview || !verticalId} className={`self-start ${primaryButtonClass}`}>
          {runningReview ? 'Running…' : 'Run weekly review'}
        </button>
        {reviewMessage && <p className="text-sm text-zinc-500">{reviewMessage}</p>}
      </div>
    </div>
  );
}

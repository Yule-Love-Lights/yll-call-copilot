'use client';

// The /scoreboard workspace: the two wall-metric tiles (quote-to-close +
// the experience flywheel), then the team board — most-improved first, full
// table second — or, during the two-week private onboarding, a rep's own
// trends only. Talks to GET /api/scoreboard and POST
// /api/scoreboard/settings. Style matches /analytics's AnalyticsView.

import { useCallback, useEffect, useState } from 'react';

type TrendPoint = { weekStart: string; weekEnd: string; avgOverall: number | null; calls: number };
type DimensionAverage = { key: string; avgScore: number; avgMax: number };

type RepStat = {
  repEmail: string;
  callsScored: number;
  avgOverall: number | null;
  avgExperience: number | null;
  perDimension: DimensionAverage[];
  trend: TrendPoint[];
  improvementDelta: number | null;
  bestWin: string | null;
};

type ScoreboardData = {
  asOf: string;
  mostImproved: RepStat[];
  topScore: RepStat[];
  teamAverages: { avgOverall: number | null; avgExperience: number | null; callsScored: number };
};

type QuoteToCloseResult = { sent: number; approved: number; rate: number | null };
type QuoteToCloseSummary = {
  trailing30: { overall: QuoteToCloseResult; byVertical: Record<string, QuoteToCloseResult> };
  seasonToDate: { overall: QuoteToCloseResult; byVertical: Record<string, QuoteToCloseResult> };
};

type FlywheelSubMetric =
  | { status: 'connected'; label: string; value: number; detail?: string }
  | { status: 'not_connected'; label: string; reason: string };

type WallMetrics = {
  quoteToClose: QuoteToCloseSummary | null;
  quoteToCloseReason?: string;
  flywheel: { referralVolume: FlywheelSubMetric; rebookRate: FlywheelSubMetric; newFiveStarReviews: FlywheelSubMetric };
};

type ScoreboardResponse = {
  configured: boolean;
  migrated?: boolean;
  reason?: string;
  error?: string;
  scope?: 'own' | 'all';
  teamBoardEnabled?: boolean;
  canManageSettings?: boolean;
  onboardingPromptDue?: boolean;
  board?: ScoreboardData;
  own?: RepStat;
  wallMetrics?: WallMetrics;
};

const cardClass = 'flex flex-col gap-3 rounded-md border border-zinc-200 p-4 dark:border-zinc-800';
const bigTileClass = 'flex flex-col gap-2 rounded-md border border-zinc-200 p-5 dark:border-zinc-800';
const primaryButtonClass =
  'rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300';
const amberBannerClass =
  'rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200';

function pct(n: number | null): string {
  return n === null ? '—' : `${n}%`;
}

// Plain divs, no chart library — same pattern as AnalyticsView's TrendChart,
// scaled 0-100 since avgOverall is already a percent-like score.
function Sparkline({ trend }: { trend: TrendPoint[] }) {
  if (trend.length === 0) return <span className="text-xs text-zinc-400">No history yet</span>;
  return (
    <div className="flex h-10 items-end gap-1">
      {trend.map(t => (
        <div
          key={t.weekStart}
          className="flex h-full w-4 flex-col justify-end"
          title={t.avgOverall === null ? `${t.weekStart.slice(0, 10)}: no calls` : `${t.weekStart.slice(0, 10)}: ${t.avgOverall}`}
        >
          <div
            className={`w-full rounded-t ${t.avgOverall === null ? 'bg-zinc-200 dark:bg-zinc-800' : 'bg-zinc-700 dark:bg-zinc-300'}`}
            style={{ height: `${t.avgOverall === null ? 4 : Math.max(4, t.avgOverall)}%` }}
          />
        </div>
      ))}
    </div>
  );
}

function FlywheelSubTile({ metric }: { metric: FlywheelSubMetric }) {
  if (metric.status === 'not_connected') {
    return (
      <div className="flex flex-col gap-1 rounded-md border border-dashed border-zinc-300 p-3 dark:border-zinc-700">
        <span className="text-xs font-medium uppercase text-zinc-400">{metric.label}</span>
        <span className="text-sm text-zinc-500">Not connected</span>
        <span className="text-xs text-zinc-400">{metric.reason}</span>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-1 rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
      <span className="text-xs font-medium uppercase text-zinc-500">{metric.label}</span>
      <span className="text-2xl font-semibold">{metric.value}%</span>
      {metric.detail && <span className="text-xs text-zinc-500">{metric.detail}</span>}
    </div>
  );
}

function RepRow({ rep, showDelta }: { rep: RepStat; showDelta: boolean }) {
  return (
    <tr className="border-t border-zinc-100 align-top dark:border-zinc-900">
      <td className="py-2 pr-4 font-medium">{rep.repEmail}</td>
      <td className="py-2 pr-4">{rep.callsScored}</td>
      <td className="py-2 pr-4">{rep.avgOverall ?? '—'}</td>
      <td className="py-2 pr-4">{rep.avgExperience ?? '—'}</td>
      {showDelta && (
        <td className="py-2 pr-4">
          {rep.improvementDelta === null ? (
            '—'
          ) : (
            <span className={rep.improvementDelta >= 0 ? 'text-green-600 dark:text-green-400' : 'text-zinc-500'}>
              {rep.improvementDelta > 0 ? '+' : ''}
              {rep.improvementDelta}
            </span>
          )}
        </td>
      )}
      <td className="py-2 pr-4">
        <Sparkline trend={rep.trend} />
      </td>
      <td className="py-2 max-w-xs truncate" title={rep.bestWin ?? undefined}>
        {rep.bestWin ?? '—'}
      </td>
    </tr>
  );
}

export default function ScoreboardView() {
  const [data, setData] = useState<ScoreboardResponse | null>(null);
  const [status, setStatus] = useState<'loading' | 'done' | 'error'>('loading');
  const [togglingBoard, setTogglingBoard] = useState(false);

  const load = useCallback(() => {
    return fetch('/api/scoreboard')
      .then(res => res.json())
      .then((json: ScoreboardResponse) => {
        setData(json);
        setStatus('done');
      })
      .catch(() => setStatus('error'));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function onToggleBoard(nextEnabled: boolean) {
    setTogglingBoard(true);
    try {
      await fetch('/api/scoreboard/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ team_board_enabled: nextEnabled }),
      });
      await load();
    } finally {
      setTogglingBoard(false);
    }
  }

  if (status === 'loading') return <p className="text-sm text-zinc-500">Loading…</p>;
  if (status === 'error' || !data) return <p className="text-sm text-red-600 dark:text-red-400">Could not load the scoreboard.</p>;
  if (data.migrated === false) return <div className={amberBannerClass}>{data.reason}</div>;
  if (data.error) return <div className={amberBannerClass}>{data.error}</div>;

  const wallMetrics = data.wallMetrics;

  return (
    <div className="flex flex-col gap-6">
      {/* Two wall metrics — big and glanceable, for a literal wall. */}
      {wallMetrics && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className={bigTileClass}>
            <span className="text-xs font-medium uppercase text-zinc-500">Quote-to-close</span>
            {wallMetrics.quoteToClose ? (
              <>
                <span className="text-4xl font-semibold">{pct(wallMetrics.quoteToClose.trailing30.overall.rate)}</span>
                <span className="text-sm text-zinc-500">
                  Trailing 30 days · {wallMetrics.quoteToClose.trailing30.overall.approved} of{' '}
                  {wallMetrics.quoteToClose.trailing30.overall.sent} quotes sent
                </span>
                <span className="text-xs text-zinc-400">
                  Season to date: {pct(wallMetrics.quoteToClose.seasonToDate.overall.rate)}
                </span>
              </>
            ) : (
              <>
                <span className="text-sm text-zinc-500">Not connected</span>
                <span className="text-xs text-zinc-400">{wallMetrics.quoteToCloseReason}</span>
              </>
            )}
          </div>

          <div className={bigTileClass}>
            <span className="text-xs font-medium uppercase text-zinc-500">Experience flywheel</span>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <FlywheelSubTile metric={wallMetrics.flywheel.referralVolume} />
              <FlywheelSubTile metric={wallMetrics.flywheel.rebookRate} />
              <FlywheelSubTile metric={wallMetrics.flywheel.newFiveStarReviews} />
            </div>
          </div>
        </div>
      )}

      {data.canManageSettings && (
        <div className={cardClass}>
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold">Team visibility</h2>
              <p className="text-sm text-zinc-500">
                {data.teamBoardEnabled
                  ? 'Everyone sees the whole board.'
                  : 'Private onboarding — each rep sees only their own trends.'}
              </p>
            </div>
            <button
              onClick={() => onToggleBoard(!data.teamBoardEnabled)}
              disabled={togglingBoard}
              className={primaryButtonClass}
            >
              {togglingBoard ? 'Saving…' : data.teamBoardEnabled ? 'Make private' : 'Make team-visible'}
            </button>
          </div>
          {data.onboardingPromptDue && !data.teamBoardEnabled && (
            <div className={amberBannerClass}>Two weeks are up — ready to go team-visible?</div>
          )}
        </div>
      )}

      {data.scope === 'own' && data.own && (
        <div className={cardClass}>
          <h2 className="text-sm font-semibold">Your trends</h2>
          <p className="text-sm text-zinc-500">
            Onboarding is private right now — only you can see your own scores. The board goes team-visible after the
            two-week onboarding period.
          </p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="flex flex-col gap-1">
              <span className="text-xs uppercase text-zinc-500">Calls scored</span>
              <span className="text-xl font-semibold">{data.own.callsScored}</span>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-xs uppercase text-zinc-500">Avg overall</span>
              <span className="text-xl font-semibold">{data.own.avgOverall ?? '—'}</span>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-xs uppercase text-zinc-500">Avg experience</span>
              <span className="text-xl font-semibold">{data.own.avgExperience ?? '—'}</span>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-xs uppercase text-zinc-500">4-week trend</span>
              <Sparkline trend={data.own.trend} />
            </div>
          </div>
          {data.own.bestWin && (
            <p className="text-sm text-zinc-600 dark:text-zinc-400">Best win this week: “{data.own.bestWin}”</p>
          )}
        </div>
      )}

      {data.scope === 'all' && data.board && (
        <>
          <div className={cardClass}>
            <h2 className="text-sm font-semibold">Most improved this week</h2>
            <p className="text-xs text-zinc-500">Celebrated as loudly as the top score — trend beats rank here.</p>
            {data.board.mostImproved.filter(r => r.improvementDelta !== null).length === 0 ? (
              <p className="text-sm text-zinc-500">No rep has enough history yet for a trend.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {data.board.mostImproved
                  .filter(r => r.improvementDelta !== null)
                  .slice(0, 3)
                  .map(rep => (
                    <li key={rep.repEmail} className="flex items-center justify-between rounded-md border border-zinc-200 px-3 py-2 dark:border-zinc-800">
                      <span className="font-medium">{rep.repEmail}</span>
                      <span className="text-green-600 dark:text-green-400">
                        {rep.improvementDelta! > 0 ? '+' : ''}
                        {rep.improvementDelta}
                      </span>
                    </li>
                  ))}
              </ul>
            )}
          </div>

          <div className={cardClass}>
            <h2 className="text-sm font-semibold">Full board</h2>
            <div className="overflow-x-auto">
              <table className="w-full min-w-max text-sm">
                <thead>
                  <tr className="text-left text-zinc-500">
                    <th className="pr-4 font-medium">Rep</th>
                    <th className="pr-4 font-medium">Calls scored</th>
                    <th className="pr-4 font-medium">Avg overall</th>
                    <th className="pr-4 font-medium">Avg experience</th>
                    <th className="pr-4 font-medium">Improvement</th>
                    <th className="pr-4 font-medium">4-week trend</th>
                    <th className="font-medium">Best win this week</th>
                  </tr>
                </thead>
                <tbody>
                  {data.board.topScore.map(rep => (
                    <RepRow key={rep.repEmail} rep={rep} showDelta />
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className={cardClass}>
            <h2 className="text-sm font-semibold">Team averages this week</h2>
            <div className="grid grid-cols-3 gap-3">
              <div className="flex flex-col gap-1">
                <span className="text-xs uppercase text-zinc-500">Calls scored</span>
                <span className="text-xl font-semibold">{data.board.teamAverages.callsScored}</span>
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-xs uppercase text-zinc-500">Avg overall</span>
                <span className="text-xl font-semibold">{data.board.teamAverages.avgOverall ?? '—'}</span>
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-xs uppercase text-zinc-500">Avg experience</span>
                <span className="text-xl font-semibold">{data.board.teamAverages.avgExperience ?? '—'}</span>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

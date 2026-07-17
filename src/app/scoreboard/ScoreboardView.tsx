'use client';

// The /scoreboard workspace: the two wall-metric tiles (quote-to-close +
// the experience flywheel), then the team board — most-improved first, full
// table second — or, during the two-week private onboarding, a rep's own
// trends only. Talks to GET /api/scoreboard and POST
// /api/scoreboard/settings. Style matches the quote-tool brand family (PR
// 1-2 of this redesign); the desktop view uses the light operator surface,
// TV mode (below) uses the portal's dark evergreen "stage light" skin.
//
// TV mode (`?tv=1`, passed down as the `tv` prop from page.tsx's
// searchParams) is a fullscreen takeover meant to sit on a shop-wall
// screen: same data, same visibility scoping as the regular view (a
// private board still shows only the two wall tiles, never rep rows), just
// laid out for reading from across a room and auto-refreshed every 5
// minutes since nobody is there to click reload.

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import type { FlywheelSubMetric } from '@/lib/scoreboard/flywheel';

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

const TV_REFRESH_MS = 5 * 60 * 1000;

const cardClass = 'flex flex-col gap-3 rounded-2xl border border-[var(--op-border)] bg-[var(--op-raised)] p-[18px] shadow-[var(--shadow-1)]';
const bigTileClass =
  'flex flex-col gap-2 rounded-2xl border border-[var(--op-border)] bg-[var(--op-raised)] p-[18px] shadow-[var(--shadow-1)] transition-transform hover:-translate-y-0.5 hover:shadow-[var(--shadow-2)]';
const primaryButtonClass =
  'rounded-[10px] bg-[var(--brand-evergreen)] px-4 py-2 text-[13.5px] font-bold text-[var(--brand-cream)] shadow-[0_4px_14px_rgba(11,20,15,0.28)] transition-transform hover:-translate-y-px disabled:opacity-50';
const amberBannerClass = 'rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900';

function pct(n: number | null): string {
  return n === null ? '—' : `${n}%`;
}

function formatTvDate(d: Date): string {
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
}

// Plain divs, no chart library — same pattern as AnalyticsView's TrendChart,
// scaled 0-100 since avgOverall is already a percent-like score.
function Sparkline({ trend }: { trend: TrendPoint[] }) {
  if (trend.length === 0) return <span className="text-xs text-[var(--op-dim)]">No history yet</span>;
  return (
    <div className="flex h-10 items-end gap-1">
      {trend.map(t => (
        <div
          key={t.weekStart}
          className="flex h-full w-4 flex-col justify-end"
          title={t.avgOverall === null ? `${t.weekStart.slice(0, 10)}: no calls` : `${t.weekStart.slice(0, 10)}: ${t.avgOverall}`}
        >
          <div
            className={`w-full rounded-t ${t.avgOverall === null ? 'bg-[var(--op-border-mid)]' : 'bg-[var(--brand-evergreen-3)]'}`}
            style={{ height: `${t.avgOverall === null ? 4 : Math.max(4, t.avgOverall)}%` }}
          />
        </div>
      ))}
    </div>
  );
}

// Renders a % suffix only when the metric is actually a rate (unit ===
// 'percent'); referral volume and 5-star reviews are counts and render
// bare. Pre-launch audit fix — this used to hardcode '%' on every
// connected value.
function FlywheelSubTile({ metric }: { metric: FlywheelSubMetric }) {
  if (metric.status === 'not_connected') {
    return (
      <div className="flex flex-col gap-1 rounded-xl border border-dashed border-[var(--brand-cream-dim)] p-3">
        <span className="text-xs font-semibold uppercase tracking-wide text-[var(--brand-cream-dim)]">{metric.label}</span>
        <span className="text-sm text-[var(--op-dim)]">Not connected</span>
        <span className="text-xs text-[var(--op-dim)]">{metric.reason}</span>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-[var(--op-border)] bg-[var(--op-raised)] p-3">
      <span className="text-xs font-semibold uppercase tracking-wide text-[var(--op-dim)]">{metric.label}</span>
      <span className="text-2xl font-bold text-[var(--op-text)]">
        {metric.value}
        {metric.unit === 'percent' ? '%' : ''}
      </span>
      {metric.detail && <span className="text-xs text-[var(--op-dim)]">{metric.detail}</span>}
    </div>
  );
}

function RepRow({ rep, showDelta }: { rep: RepStat; showDelta: boolean }) {
  return (
    <tr className="border-t border-[var(--op-border)] align-top">
      <td className="py-2 pr-4 font-medium text-[var(--op-text)]">{rep.repEmail}</td>
      <td className="py-2 pr-4 text-[var(--op-text-2)]">{rep.callsScored}</td>
      <td className="py-2 pr-4 text-[var(--op-text-2)]">{rep.avgOverall ?? '—'}</td>
      <td className="py-2 pr-4 text-[var(--op-text-2)]">{rep.avgExperience ?? '—'}</td>
      {showDelta && (
        <td className="py-2 pr-4">
          {rep.improvementDelta === null ? (
            '—'
          ) : (
            <span className={rep.improvementDelta >= 0 ? 'text-green-700' : 'text-[var(--op-dim)]'}>
              {rep.improvementDelta > 0 ? '+' : ''}
              {rep.improvementDelta}
            </span>
          )}
        </td>
      )}
      <td className="py-2 pr-4">
        <Sparkline trend={rep.trend} />
      </td>
      <td className="max-w-xs truncate py-2 text-[var(--op-text-2)]" title={rep.bestWin ?? undefined}>
        {rep.bestWin ?? '—'}
      </td>
    </tr>
  );
}

// ─── TV mode pieces ────────────────────────────────────────────────────────
// Dark-skin counterparts of the tiles above. Kept as separate small
// components rather than a variant prop threaded through the light ones —
// the two skins share almost no className, so a branchy shared component
// would be harder to read than two short ones.

function TvFlyTile({ metric }: { metric: FlywheelSubMetric }) {
  if (metric.status === 'not_connected') {
    return (
      <div className="flex min-w-[110px] flex-1 flex-col gap-1 rounded-xl border border-dashed border-[var(--brand-cream-dim)] px-4 py-3">
        <span className="text-[10px] font-extrabold uppercase tracking-[.16em] text-[var(--brand-cream-dim)]">{metric.label}</span>
        <span className="text-sm text-[var(--brand-cream-dim)]">Not connected</span>
      </div>
    );
  }
  return (
    <div className="tv-fly-tile flex min-w-[110px] flex-1 flex-col gap-0.5 rounded-xl px-4 py-3">
      <span className="text-[10px] font-extrabold uppercase tracking-[.16em] text-[var(--brand-cream-2)]">{metric.label}</span>
      <span className="text-[26px] font-extrabold tabular-nums text-[var(--brand-cream)]">
        {metric.value}
        {metric.unit === 'percent' ? '%' : ''}
      </span>
    </div>
  );
}

function TvBoardRow({ rep }: { rep: RepStat }) {
  const barPct = Math.max(0, Math.min(100, rep.avgOverall ?? 0));
  return (
    <tr className="border-t border-[rgba(244,236,216,0.08)]">
      <td className="py-[11px] pr-[10px] font-bold text-[var(--brand-cream)]">{rep.repEmail}</td>
      <td className="py-[11px] pr-[10px] tabular-nums text-[var(--brand-cream)]">{rep.callsScored}</td>
      <td className="py-[11px] pr-[10px] tabular-nums text-[var(--brand-cream)]">{rep.avgExperience ?? '—'}</td>
      <td className="w-[34%] py-[11px] pr-[10px]">
        <div className="tv-bar h-[9px] rounded-[5px]" style={{ width: `${barPct}%` }} />
      </td>
    </tr>
  );
}

export default function ScoreboardView({ tv = false }: { tv?: boolean }) {
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

  // TV mode only — nobody is standing at a wall-mounted screen to click
  // reload, so keep the board current on its own. Cleared on unmount /
  // whenever `tv` flips off.
  useEffect(() => {
    if (!tv) return;
    const id = setInterval(load, TV_REFRESH_MS);
    return () => clearInterval(id);
  }, [tv, load]);

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

  if (status === 'loading') return <p className="text-sm text-[var(--op-dim)]">Loading…</p>;
  if (status === 'error' || !data) return <p className="text-sm text-[var(--brand-red)]">Could not load the scoreboard.</p>;
  if (data.migrated === false) return <div className={amberBannerClass}>{data.reason}</div>;
  if (data.error) return <div className={amberBannerClass}>{data.error}</div>;

  const wallMetrics = data.wallMetrics;

  if (tv) {
    const topImproved = data.scope === 'all' ? data.board?.mostImproved.find(r => r.improvementDelta !== null) : undefined;

    return (
      <div className="tv-stage fixed inset-0 z-[100] flex min-h-screen flex-col gap-6 overflow-hidden p-8 pb-9">
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
          <span className="bg-gradient-to-r from-[var(--brand-gold)] to-[var(--brand-gold-bright)] bg-clip-text text-xl font-extrabold tracking-[-.01em] text-transparent">
            Yule Love Lights
          </span>
          <span className="text-[13px] font-semibold text-[var(--brand-cream-dim)]">{formatTvDate(new Date())}</span>
        </div>

        <Link
          href="/scoreboard"
          className="absolute right-6 top-6 text-xs font-semibold text-[var(--brand-cream-dim)] hover:text-[var(--brand-cream)]"
        >
          Exit
        </Link>

        {wallMetrics && (
          <div className="grid shrink-0 grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="tv-tile flex flex-col gap-2 rounded-2xl px-[26px] py-6">
              <span className="text-[10.5px] font-extrabold uppercase tracking-[.2em] text-[var(--brand-cream-dim)]">Quote-to-close</span>
              {wallMetrics.quoteToClose ? (
                <>
                  <span className="text-[72px] font-extrabold leading-none tracking-[-.03em] tabular-nums text-[var(--brand-cream)]">
                    {wallMetrics.quoteToClose.trailing30.overall.rate ?? '—'}
                    {wallMetrics.quoteToClose.trailing30.overall.rate !== null && (
                      <small className="text-[28px] font-bold text-[var(--brand-cream-dim)]">%</small>
                    )}
                  </span>
                  <span className="text-[13.5px] text-[var(--brand-cream-dim)]">
                    Trailing 30 days · {wallMetrics.quoteToClose.trailing30.overall.approved} of{' '}
                    {wallMetrics.quoteToClose.trailing30.overall.sent} quotes sent
                  </span>
                </>
              ) : (
                <>
                  <span className="text-lg text-[var(--brand-cream-2)]">Not connected</span>
                  <span className="text-xs text-[var(--brand-cream-dim)]">{wallMetrics.quoteToCloseReason}</span>
                </>
              )}
            </div>

            <div className="tv-tile flex flex-col gap-2 rounded-2xl px-[26px] py-6">
              <span className="text-[10.5px] font-extrabold uppercase tracking-[.2em] text-[var(--brand-cream-dim)]">Experience flywheel</span>
              <div className="flex flex-wrap gap-3">
                <TvFlyTile metric={wallMetrics.flywheel.referralVolume} />
                <TvFlyTile metric={wallMetrics.flywheel.rebookRate} />
                <TvFlyTile metric={wallMetrics.flywheel.newFiveStarReviews} />
              </div>
              <span className="text-[13.5px] text-[var(--brand-cream-dim)]">The cheapest growth there is.</span>
            </div>
          </div>
        )}

        {data.scope === 'own' && (
          <p className="shrink-0 text-[13px] text-[var(--brand-cream-dim)]">Board goes team-visible after onboarding.</p>
        )}

        {data.scope === 'all' && data.board && (
          <>
            {topImproved && (
              <div className="tv-improved flex shrink-0 flex-wrap items-center gap-[18px] rounded-2xl px-6 py-[18px]">
                <span className="text-[11px] font-extrabold uppercase tracking-[.24em]">Most improved</span>
                <span className="text-2xl font-extrabold tracking-[-.01em]">{topImproved.repEmail}</span>
                <span className="text-2xl font-extrabold tabular-nums">
                  {topImproved.improvementDelta! > 0 ? '+' : ''}
                  {topImproved.improvementDelta}
                </span>
                {topImproved.bestWin && (
                  <span className="basis-full text-sm font-semibold text-[var(--brand-evergreen-2)]">{topImproved.bestWin}</span>
                )}
              </div>
            )}

            <div className="min-h-0 flex-1 overflow-y-auto">
              <table className="w-full text-[15px]">
                <thead>
                  <tr>
                    <th className="pb-[9px] pr-[10px] text-left text-[10.5px] font-extrabold uppercase tracking-[.2em] text-[var(--brand-cream-dim)]">
                      Rep
                    </th>
                    <th className="pb-[9px] pr-[10px] text-left text-[10.5px] font-extrabold uppercase tracking-[.2em] text-[var(--brand-cream-dim)]">
                      Calls
                    </th>
                    <th className="pb-[9px] pr-[10px] text-left text-[10.5px] font-extrabold uppercase tracking-[.2em] text-[var(--brand-cream-dim)]">
                      Experience
                    </th>
                    <th className="w-[34%] pb-[9px] pr-[10px] text-left text-[10.5px] font-extrabold uppercase tracking-[.2em] text-[var(--brand-cream-dim)]">
                      This week
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.board.topScore.map(rep => (
                    <TvBoardRow key={rep.repEmail} rep={rep} />
                  ))}
                </tbody>
              </table>
            </div>

            <span className="shrink-0 text-[12.5px] text-[var(--brand-cream-dim)]">
              Scores are team-visible. Coaching stays one-on-one.
            </span>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Two wall metrics — big and glanceable, for a literal wall. */}
      {wallMetrics && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className={bigTileClass}>
            <span className="text-xs font-semibold uppercase text-[var(--op-dim)]">Quote-to-close</span>
            {wallMetrics.quoteToClose ? (
              <>
                <span className="text-4xl font-bold text-[var(--op-text)]">{pct(wallMetrics.quoteToClose.trailing30.overall.rate)}</span>
                <span className="text-sm text-[var(--op-dim)]">
                  Trailing 30 days · {wallMetrics.quoteToClose.trailing30.overall.approved} of{' '}
                  {wallMetrics.quoteToClose.trailing30.overall.sent} quotes sent
                </span>
                <span className="text-xs text-[var(--brand-cream-dim)]">
                  Season to date: {pct(wallMetrics.quoteToClose.seasonToDate.overall.rate)}
                </span>
              </>
            ) : (
              <>
                <span className="text-sm text-[var(--op-dim)]">Not connected</span>
                <span className="text-xs text-[var(--brand-cream-dim)]">{wallMetrics.quoteToCloseReason}</span>
              </>
            )}
          </div>

          <div className={bigTileClass}>
            <span className="text-xs font-semibold uppercase text-[var(--op-dim)]">Experience flywheel</span>
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
              <h2 className="text-sm font-semibold text-[var(--op-text)]">Team visibility</h2>
              <p className="text-sm text-[var(--op-dim)]">
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
          <h2 className="text-sm font-semibold text-[var(--op-text)]">Your trends</h2>
          <p className="text-sm text-[var(--op-dim)]">
            Onboarding is private right now — only you can see your own scores. The board goes team-visible after the
            two-week onboarding period.
          </p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="flex flex-col gap-1">
              <span className="text-xs uppercase text-[var(--op-dim)]">Calls scored</span>
              <span className="text-xl font-bold text-[var(--op-text)]">{data.own.callsScored}</span>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-xs uppercase text-[var(--op-dim)]">Avg overall</span>
              <span className="text-xl font-bold text-[var(--op-text)]">{data.own.avgOverall ?? '—'}</span>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-xs uppercase text-[var(--op-dim)]">Avg experience</span>
              <span className="text-xl font-bold text-[var(--op-text)]">{data.own.avgExperience ?? '—'}</span>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-xs uppercase text-[var(--op-dim)]">4-week trend</span>
              <Sparkline trend={data.own.trend} />
            </div>
          </div>
          {data.own.bestWin && <p className="text-sm text-[var(--op-text-2)]">Best win this week: “{data.own.bestWin}”</p>}
        </div>
      )}

      {data.scope === 'all' && data.board && (
        <>
          <div className={cardClass}>
            <h2 className="text-sm font-semibold text-[var(--op-text)]">Most improved this week</h2>
            <p className="text-xs text-[var(--op-dim)]">Celebrated as loudly as the top score — trend beats rank here.</p>
            {data.board.mostImproved.filter(r => r.improvementDelta !== null).length === 0 ? (
              <p className="text-sm text-[var(--op-dim)]">No rep has enough history yet for a trend.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {data.board.mostImproved
                  .filter(r => r.improvementDelta !== null)
                  .slice(0, 3)
                  .map(rep => (
                    <li
                      key={rep.repEmail}
                      className="flex items-center justify-between rounded-xl border border-[var(--op-border)] px-3 py-2"
                    >
                      <span className="font-medium text-[var(--op-text)]">{rep.repEmail}</span>
                      <span className="text-green-700">
                        {rep.improvementDelta! > 0 ? '+' : ''}
                        {rep.improvementDelta}
                      </span>
                    </li>
                  ))}
              </ul>
            )}
          </div>

          <div className={cardClass}>
            <h2 className="text-sm font-semibold text-[var(--op-text)]">Full board</h2>
            <div className="overflow-x-auto">
              <table className="w-full min-w-max text-sm">
                <thead>
                  <tr className="text-left text-[var(--op-dim)]">
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
            <h2 className="text-sm font-semibold text-[var(--op-text)]">Team averages this week</h2>
            <div className="grid grid-cols-3 gap-3">
              <div className="flex flex-col gap-1">
                <span className="text-xs uppercase text-[var(--op-dim)]">Calls scored</span>
                <span className="text-xl font-bold text-[var(--op-text)]">{data.board.teamAverages.callsScored}</span>
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-xs uppercase text-[var(--op-dim)]">Avg overall</span>
                <span className="text-xl font-bold text-[var(--op-text)]">{data.board.teamAverages.avgOverall ?? '—'}</span>
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-xs uppercase text-[var(--op-dim)]">Avg experience</span>
                <span className="text-xl font-bold text-[var(--op-text)]">{data.board.teamAverages.avgExperience ?? '—'}</span>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// Home: the daily dashboard (PR 2 of 3, the mockup's Mock 1). Server
// component so the greeting, the new-cards count, the month trend, and the
// queue counts can all be read straight from the signed-in session and
// Supabase without a client-side fetch waterfall -- same "server component
// for the config/session-aware parts" pattern as /coach and /contacts.
//
// The rest of what this page rendered before (connection health, the
// this-week stat row + brain-review link, sign-out) is unchanged in
// function and lives in HomeConnectionPanel.tsx, below the new dashboard --
// it still needs the browser (fetch-on-mount, a click handler), so it
// couldn't move into this server component too. The old flat quick-link
// nav list is gone; CoachNav.tsx (in layout.tsx) replaces it everywhere.

import Link from 'next/link';
import { getSupabaseServerClient, isMissingTableError, isSupabaseConfigured } from '@/lib/supabase';
import { getSessionEmail } from '@/lib/auth/session';
import { loadCallScores } from '@/lib/scoreboard/loader';
import { buildRepStat, type CallScoreRow } from '@/lib/scoreboard/stats';
import { summarizeHomeTrend } from '@/lib/scoreboard/homeTrendSummary';
import { resolveCurrentHubActor } from '@/lib/auth/resource';
import HomeConnectionPanel from './HomeConnectionPanel';
import { redirect } from 'next/navigation';

// Config + session are read per-request, not baked at build time -- same
// reasoning as /login and /contacts.
export const dynamic = 'force-dynamic';

function timeOfDayGreeting(now: Date): 'Morning' | 'Afternoon' | 'Evening' {
  const hour = now.getHours();
  if (hour < 12) return 'Morning';
  if (hour < 18) return 'Afternoon';
  return 'Evening';
}

// "jamie.smith+test@yulelovelights.com" -> "Jamie". Falls back to null (the
// caller renders a plain "Morning." greeting) for anything that doesn't
// leave a usable word before the @.
function firstNameFromEmail(email: string | null): string | null {
  if (!email) return null;
  const local = email.split('@')[0] ?? '';
  const first = local.split(/[._+-]+/).find(part => part.length > 0);
  if (!first) return null;
  return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
}

export default async function Home() {
  const actorResolution = await resolveCurrentHubActor();
  if (actorResolution.status === 'resolved' && actorResolution.actor.role === 'owner_admin') {
    redirect('/management');
  }

  const configured = isSupabaseConfigured();
  const repEmail = configured ? await getSessionEmail() : null;
  const firstName = firstNameFromEmail(repEmail);
  const greeting = timeOfDayGreeting(new Date());

  let unseenCount = 0;
  let scoreRows: CallScoreRow[] = [];
  let secondMileQueueCount = 0;
  let recordingsQueueCount = 0;

  if (configured && repEmail) {
    const supabase = getSupabaseServerClient()!;

    const { count: feedbackCount, error: feedbackError } = await supabase
      .from('feedback_cards')
      .select('id, call_scores!inner(metric_scope)', { count: 'exact', head: true })
      .eq('call_scores.metric_scope', 'performance')
      .eq('rep_email', repEmail)
      .is('seen_at', null);
    if (feedbackError && !isMissingTableError(feedbackError)) {
      console.error('Load unseen coaching card count for home failed:', feedbackError);
    }
    unseenCount = feedbackCount ?? 0;

    const scoresResult = await loadCallScores(supabase, { repEmail });
    if (scoresResult.ok) scoreRows = scoresResult.rows;

    const { count: secondMileCount, error: secondMileError } = await supabase
      .from('second_mile_touches')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending');
    if (secondMileError && !isMissingTableError(secondMileError)) {
      console.error('Load second-mile queue count for home failed:', secondMileError);
    }
    secondMileQueueCount = secondMileCount ?? 0;

    const { count: recordingsCount, error: recordingsError } = await supabase
      .from('call_recordings')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending');
    if (recordingsError && !isMissingTableError(recordingsError)) {
      console.error('Load recordings queue count for home failed:', recordingsError);
    }
    recordingsQueueCount = recordingsCount ?? 0;
  }

  // buildRepStat is pure -- calling it with an empty repEmail/rows (the
  // degraded/no-session case) still returns a well-formed 4-point trend
  // (every week null), so the sparkline always renders 4 bars instead of
  // needing its own separate empty-state branch here.
  const repStat = buildRepStat(repEmail ?? '', scoreRows, new Date());
  const trendSummary = summarizeHomeTrend(repStat.trend);

  const totalQueued = secondMileQueueCount + recordingsQueueCount;
  const queuesLine =
    totalQueued === 0
      ? "Nothing time-sensitive is waiting."
      : secondMileQueueCount > 0
        ? 'Second-mile touches are ready to send.'
        : 'Recordings are still finishing up.';

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-[28px] font-extrabold leading-tight tracking-[-.02em] text-[var(--op-text)]">
          {firstName ? (
            <>
              {greeting},{' '}
              <span className="bg-gradient-to-r from-[var(--brand-gold-deep)] to-[var(--brand-gold)] bg-clip-text text-transparent">
                {firstName}
              </span>
              .
            </>
          ) : (
            `${greeting}.`
          )}
        </h1>
        <p className="text-[15px] text-[var(--op-dim)]">
          {unseenCount > 0
            ? `${unseenCount} new coaching card${unseenCount === 1 ? '' : 's'} waiting.`
            : "You're all caught up on coaching cards."}
        </p>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-3.5 sm:grid-cols-3">
        <div
          className={`flex flex-col gap-2 rounded-2xl border p-[18px] shadow-[var(--shadow-1)] transition-transform hover:-translate-y-0.5 hover:shadow-[var(--shadow-2)] ${
            unseenCount > 0
              ? 'border-transparent bg-gradient-to-br from-[#FFF7E4] to-[var(--op-raised)] shadow-[var(--gold-glow)]'
              : 'border-[var(--op-border)] bg-[var(--op-raised)]'
          }`}
        >
          <span className="text-[10.5px] font-extrabold uppercase tracking-[.2em] text-[var(--op-dim)]">
            New coaching cards
          </span>
          <span className="text-[34px] font-extrabold leading-none tracking-[-.02em] tabular-nums text-[var(--op-text)]">
            {unseenCount}
          </span>
          <span className="text-[13.5px] text-[var(--op-dim)]">
            {unseenCount > 0 ? '30 seconds each. Worth the read.' : 'All caught up.'}
          </span>
          <Link
            href="/coach"
            className="mt-1 inline-flex w-fit items-center rounded-[10px] bg-[var(--brand-evergreen)] px-4 py-2 text-[13.5px] font-bold text-[var(--brand-cream)] shadow-[0_4px_14px_rgba(11,20,15,0.28)] transition-transform hover:-translate-y-px"
          >
            Read them
          </Link>
        </div>

        <div className="flex flex-col gap-2 rounded-2xl border border-[var(--op-border)] bg-[var(--op-raised)] p-[18px] shadow-[var(--shadow-1)] transition-transform hover:-translate-y-0.5 hover:shadow-[var(--shadow-2)]">
          <span className="text-[10.5px] font-extrabold uppercase tracking-[.2em] text-[var(--op-dim)]">Your month</span>
          <div className="mt-0.5 flex h-12 items-end gap-1">
            {trendSummary.bars.map((bar, i) => (
              <span
                key={i}
                className={`max-w-[18px] min-w-0 flex-1 rounded-t-[5px] rounded-b-[2px] ${
                  i === trendSummary.bars.length - 1 && bar.hasData
                    ? 'bg-gradient-to-b from-[var(--brand-gold-bright)] to-[var(--brand-gold)] shadow-[0_2px_10px_rgba(232,184,98,0.5)]'
                    : 'bg-gradient-to-b from-[#4A5C50] to-[var(--brand-evergreen-3)] opacity-45'
                }`}
                style={{ height: `${bar.heightPct}%` }}
              />
            ))}
          </div>
          <span className="text-[13.5px] text-[var(--op-dim)]">{trendSummary.headline}</span>
        </div>

        <div className="flex flex-col gap-2 rounded-2xl border border-[var(--op-border)] bg-[var(--op-raised)] p-[18px] shadow-[var(--shadow-1)] transition-transform hover:-translate-y-0.5 hover:shadow-[var(--shadow-2)]">
          <span className="text-[10.5px] font-extrabold uppercase tracking-[.2em] text-[var(--op-dim)]">
            Today&apos;s queues
          </span>
          <div className="flex flex-wrap gap-2">
            <Link
              href="/second-mile"
              className="inline-flex items-center gap-1.5 rounded-full border border-[var(--op-border-mid)] bg-white/70 px-3.5 py-1.5 text-[13px] font-semibold text-[var(--op-text-2)]"
            >
              Second mile <b className="tabular-nums text-[var(--op-text)]">{secondMileQueueCount}</b>
            </Link>
            <Link
              href="/recordings"
              className="inline-flex items-center gap-1.5 rounded-full border border-[var(--op-border-mid)] bg-white/70 px-3.5 py-1.5 text-[13px] font-semibold text-[var(--op-text-2)]"
            >
              Recordings <b className="tabular-nums text-[var(--op-text)]">{recordingsQueueCount}</b>
            </Link>
          </div>
          <span className="text-[13.5px] text-[var(--op-dim)]">{queuesLine}</span>
        </div>
      </div>

      <div className="mt-10">
        <HomeConnectionPanel />
      </div>
    </main>
  );
}

'use client';

// The /digest workspace: the newest digest rendered in full for the Friday
// steer (trends narrative, the three lowest dimensions as the training
// focus, the best call celebrated, the roughest moment framed for a private
// 1:1, this week's playbook proposals, and the role-play scenario), plus a
// small history list of past digests to click into. Talks to GET /api/digest
// and POST /api/digest/generate.

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { formatOverallGlance, formatOverallExact } from '@/lib/formatScore';

type RepAverage = {
  repEmail: string;
  calls: number;
  avgOverall: number;
  avgExperience: number;
  deltaOverall: number | null;
  deltaExperience: number | null;
};
type DimensionStat = { key: string; label: string; avgRatio: number; calls: number };
type GuaranteeRate = { key: string; label: string; done: number; applicable: number; rate: number | null };
type BestCall = { id: string; repEmail: string; overall: number; win: string | null };
// timestampSeconds is nullable -- the scorer doesn't always pin a fix moment
// to a spot in the transcript (see src/lib/scoring/types.ts's Fix). CallBrowser
// and the feedback card already guard this the same way; the digest didn't,
// which rendered a misleading "0:00" chip.
type FixMoment = { moment: string; timestampSeconds: number | null; transcriptQuote: string; betterLine: string };
type RoughestMoment = { id: string; repEmail: string; overall: number; fix: FixMoment };
type Proposal = {
  id: string;
  verticalId: string;
  verticalName: string;
  section: string;
  kind: string;
  evidence: string;
  createdAt: string;
};
type RolePlay = { setup: string; whatTheCustomerSays: string; whatGoodLooksLike: string };

type DigestStats = {
  periodStart: string;
  periodEnd: string;
  team: { calls: number; reps: number; avgOverall: number | null; avgExperience: number | null };
  reps: RepAverage[];
  lowestDimensions: DimensionStat[];
  guarantees: GuaranteeRate[];
  bestCall: BestCall | null;
  roughestMoment: RoughestMoment | null;
};

type DigestContent = {
  stats: DigestStats;
  narrative: string;
  trainingFocus: string;
  bestCall: BestCall | null;
  roughestMoment: RoughestMoment | null;
  proposals: Proposal[];
  rolePlay: RolePlay | null;
};

type Digest = { id: string; periodStart: string; periodEnd: string; content: DigestContent; createdAt: string };

const cardClass = 'flex flex-col gap-3 rounded-md border border-zinc-200 p-4 dark:border-zinc-800';
const primaryButtonClass =
  'rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300';
const amberBannerClass =
  'rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200';
const errorTextClass = 'text-sm text-red-600 dark:text-red-400';

function formatTimestamp(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function formatDelta(delta: number | null): string {
  if (delta === null) return 'no prior week';
  if (delta === 0) return 'steady';
  return delta > 0 ? `up ${delta}` : `down ${Math.abs(delta)}`;
}

function DigestPanel({ digest }: { digest: Digest }) {
  const { content } = digest;
  const { stats } = content;

  return (
    <div className="flex flex-col gap-4">
      <div className={cardClass}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">Team trends</h2>
          <span className="text-xs text-zinc-500">
            {digest.periodStart} to {digest.periodEnd}
          </span>
        </div>
        <p className="text-sm">{content.narrative}</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="flex flex-col gap-1 rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
            <span className="text-xs font-medium uppercase text-zinc-500">Calls scored</span>
            <span className="text-2xl font-semibold">{stats.team.calls}</span>
          </div>
          <div className="flex flex-col gap-1 rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
            <span className="text-xs font-medium uppercase text-zinc-500">Reps</span>
            <span className="text-2xl font-semibold">{stats.team.reps}</span>
          </div>
          <div className="flex flex-col gap-1 rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
            <span className="text-xs font-medium uppercase text-zinc-500">Avg overall</span>
            <span className="text-2xl font-semibold">{stats.team.avgOverall !== null ? formatOverallGlance(stats.team.avgOverall) : '—'}</span>
          </div>
          <div className="flex flex-col gap-1 rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
            <span className="text-xs font-medium uppercase text-zinc-500">Avg experience</span>
            <span className="text-2xl font-semibold">{stats.team.avgExperience ?? '—'}</span>
          </div>
        </div>
        {stats.reps.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-max text-sm">
              <thead>
                <tr className="text-left text-zinc-500">
                  <th className="pr-4 font-medium">Rep</th>
                  <th className="pr-4 font-medium">Calls</th>
                  <th className="pr-4 font-medium">Avg overall</th>
                  <th className="pr-4 font-medium">Vs. last week</th>
                  <th className="font-medium">Avg experience</th>
                </tr>
              </thead>
              <tbody>
                {stats.reps.map(r => (
                  <tr key={r.repEmail} className="border-t border-zinc-100 dark:border-zinc-900">
                    <td className="py-1 pr-4">{r.repEmail}</td>
                    <td className="py-1 pr-4">{r.calls}</td>
                    <td className="py-1 pr-4">{formatOverallGlance(r.avgOverall)}</td>
                    <td className="py-1 pr-4">{formatDelta(r.deltaOverall)}</td>
                    <td className="py-1">{r.avgExperience}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className={cardClass}>
        <h2 className="text-sm font-semibold">This week&apos;s training focus</h2>
        <p className="text-sm">{content.trainingFocus}</p>
        {stats.lowestDimensions.length > 0 && (
          <ul className="flex flex-col gap-1 text-sm">
            {stats.lowestDimensions.map(d => (
              <li key={d.key} className="flex items-center justify-between border-t border-zinc-100 py-1 dark:border-zinc-900">
                <span>{d.label}</span>
                <span className="text-zinc-500">
                  {d.avgRatio}% ({d.calls} call{d.calls === 1 ? '' : 's'})
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {content.bestCall && (
        <div className={cardClass}>
          <h2 className="text-sm font-semibold">🏆 Best call this week</h2>
          <p className="text-sm text-zinc-500">
            {content.bestCall.repEmail} · overall {formatOverallExact(content.bestCall.overall)}
          </p>
          {content.bestCall.win && <p className="text-sm italic">&quot;{content.bestCall.win}&quot;</p>}
        </div>
      )}

      {content.roughestMoment && (
        <div className={cardClass}>
          <h2 className="text-sm font-semibold">Worth a private 1:1</h2>
          <p className="text-xs text-zinc-500">Coach one-on-one, never a public callout.</p>
          <p className="text-sm text-zinc-500">
            {content.roughestMoment.repEmail} · overall {formatOverallExact(content.roughestMoment.overall)}
            {content.roughestMoment.fix.timestampSeconds !== null && <> · at {formatTimestamp(content.roughestMoment.fix.timestampSeconds)}</>}
          </p>
          <p className="text-sm">{content.roughestMoment.fix.moment}</p>
          <p className="text-sm italic">&quot;{content.roughestMoment.fix.transcriptQuote}&quot;</p>
          <p className="text-sm">
            <span className="font-medium">Next time: </span>
            {content.roughestMoment.fix.betterLine}
          </p>
        </div>
      )}

      {content.rolePlay && (
        <div className={cardClass}>
          <h2 className="text-sm font-semibold">Role-play scenario</h2>
          <p className="text-sm">
            <span className="font-medium">Setup: </span>
            {content.rolePlay.setup}
          </p>
          <p className="text-sm">
            <span className="font-medium">The customer says: </span>&quot;{content.rolePlay.whatTheCustomerSays}&quot;
          </p>
          <p className="text-sm">
            <span className="font-medium">What good looks like: </span>
            {content.rolePlay.whatGoodLooksLike}
          </p>
        </div>
      )}

      <div className={cardClass}>
        <h2 className="text-sm font-semibold">Playbook proposals this week</h2>
        {content.proposals.length === 0 ? (
          <p className="text-sm text-zinc-500">No new proposals this week.</p>
        ) : (
          <ul className="flex flex-col gap-2 text-sm">
            {content.proposals.map(p => (
              <li key={p.id} className="flex flex-col gap-1 border-t border-zinc-100 py-2 dark:border-zinc-900">
                <div className="flex items-center justify-between">
                  <span className="font-medium">
                    {p.verticalName} · {p.kind} {p.section}
                  </span>
                  <Link href={`/verticals/${p.verticalId}#proposals`} className="text-sm text-blue-600 hover:underline dark:text-blue-400">
                    Review →
                  </Link>
                </div>
                <span className="text-zinc-500">{p.evidence}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {stats.guarantees.some(g => g.applicable > 0) && (
        <div className={cardClass}>
          <h2 className="text-sm font-semibold">Guarantee say-rates</h2>
          <ul className="flex flex-col gap-1 text-sm">
            {stats.guarantees
              .filter(g => g.applicable > 0)
              .map(g => (
                <li key={g.key} className="flex items-center justify-between border-t border-zinc-100 py-1 dark:border-zinc-900">
                  <span>{g.label}</span>
                  <span className="text-zinc-500">
                    {g.rate}% ({g.done}/{g.applicable})
                  </span>
                </li>
              ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export default function DigestView() {
  const [digests, setDigests] = useState<Digest[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // 'forbidden' -- the API's 403 for a rep (the digest is owner-facing; see
  // GET /api/digest's role gate) -- shows a friendly explanation instead of
  // the digest, rather than falling into the generic 'error' state.
  const [status, setStatus] = useState<'loading' | 'done' | 'error' | 'forbidden'>('loading');
  const [reason, setReason] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [generateError, setGenerateError] = useState<string | null>(null);

  // Not called synchronously on mount from within the effect body's own
  // scope (react-hooks/set-state-in-effect) -- load() only ever sets state
  // inside its fetch().then()/.catch() callbacks, same convention as
  // AnalyticsView's load(). status starts as 'loading' via useState above,
  // so the initial mount doesn't need its own synchronous flip.
  function load() {
    fetch('/api/digest')
      .then(async res => {
        if (res.status === 403) {
          setStatus('forbidden');
          return;
        }
        const json = await res.json();
        if (json.reason) setReason(json.reason);
        const list = (json.digests ?? []) as Digest[];
        setDigests(list);
        setSelectedId(prev => (prev && list.some(d => d.id === prev) ? prev : (list[0]?.id ?? null)));
        setStatus('done');
      })
      .catch(() => setStatus('error'));
  }

  useEffect(() => {
    load();
  }, []);

  async function onGenerate() {
    setGenerating(true);
    setMessage(null);
    setGenerateError(null);
    try {
      const res = await fetch('/api/digest/generate', { method: 'POST' });
      const json = await res.json();
      if (!json.generated) {
        setMessage(json.reason ?? 'Could not generate the digest.');
        return;
      }
      setMessage('Digest generated.');
      load();
      setSelectedId(json.digest.id);
    } catch {
      setGenerateError('Could not generate the digest. Try again.');
    } finally {
      setGenerating(false);
    }
  }

  const selected = digests.find(d => d.id === selectedId) ?? null;
  const history = digests.filter(d => d.id !== selectedId);

  // A rep gets the friendly explanation, not the digest workspace -- the
  // digest is the coach's Friday review, and it's not something to blank
  // out awkwardly or half-render after an API 403.
  if (status === 'forbidden') {
    return <div className={amberBannerClass}>The weekly digest is for the coach&apos;s Friday review.</div>;
  }

  return (
    <div className="flex flex-col gap-6">
      <button onClick={onGenerate} disabled={generating} className={`self-start ${primaryButtonClass}`}>
        {generating ? 'Generating…' : 'Generate now'}
      </button>
      {message && <p className="text-sm text-zinc-500">{message}</p>}
      {generateError && <p className={errorTextClass}>{generateError}</p>}

      {status === 'loading' && <p className="text-sm text-zinc-500">Loading…</p>}
      {status === 'error' && <p className={errorTextClass}>Could not load digests.</p>}
      {reason && <div className={amberBannerClass}>{reason}</div>}

      {status === 'done' && digests.length === 0 && !reason && (
        <p className="text-sm text-zinc-500">No digest yet — click &quot;Generate now&quot; to build this week&apos;s.</p>
      )}

      {selected && <DigestPanel digest={selected} />}

      {history.length > 0 && (
        <div className={cardClass}>
          <h2 className="text-sm font-semibold">History</h2>
          <ul className="flex flex-col gap-1 text-sm">
            {history.map(d => (
              <li key={d.id}>
                <button
                  onClick={() => setSelectedId(d.id)}
                  className="w-full rounded-md px-2 py-1.5 text-left hover:bg-zinc-50 dark:hover:bg-zinc-900"
                >
                  <span className="font-medium">
                    {d.periodStart} to {d.periodEnd}
                  </span>{' '}
                  <span className="text-zinc-500">· {d.content.stats.team.calls} calls scored</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

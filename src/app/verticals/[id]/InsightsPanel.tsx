'use client';

// "Insights" section on /verticals/[id]: renders the objection-frequency
// table, top customer questions, what worked/failed, and price-talk
// snippets mined from extracted transcripts (GET .../insights), plus a
// "Propose playbook updates" button (POST .../distill) and the resulting
// pending proposals with a diff-style before/after and Approve/Reject
// (POST /api/proposals/[id]/decide).

import { useCallback, useEffect, useState } from 'react';

type Insights = {
  totalCalls: number;
  booked: number;
  notBooked: number;
  unknownOutcome: number;
  topObjections: { objection: string; count: number; pct: number }[];
  topQuestions: { question: string; count: number }[];
  topWhatWorked: { item: string; count: number }[];
  topWhatFailed: { item: string; count: number }[];
  samplePriceTalk: string[];
};

type Proposal = {
  id: string;
  section: string;
  kind: string;
  currentValue: unknown;
  proposedValue: unknown;
  evidence: string;
  createdAt: string;
};

const primaryButtonClass =
  'rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300';
const secondaryButtonClass =
  'rounded-md border border-zinc-300 px-3 py-1 text-sm hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-900';
const amberBannerClass =
  'rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200';

function renderValue(v: unknown): string {
  if (v === null || v === undefined) return '(none)';
  if (typeof v === 'string') return v;
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if (typeof o.label === 'string' && typeof o.script === 'string') return `${o.label}: ${o.script}`;
    if (typeof o.objection === 'string' && typeof o.response === 'string') return `${o.objection}: ${o.response}`;
  }
  return JSON.stringify(v);
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-zinc-200 dark:border-zinc-800">
      <h3 className="border-b border-zinc-200 px-4 py-2 text-sm font-semibold dark:border-zinc-800">{title}</h3>
      <div className="px-4 py-3">{children}</div>
    </div>
  );
}

export default function InsightsPanel({ verticalId }: { verticalId: string }) {
  const [insights, setInsights] = useState<Insights | null>(null);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [extractedCalls, setExtractedCalls] = useState(0);
  const [migrated, setMigrated] = useState(true);
  const [status, setStatus] = useState<'loading' | 'done' | 'error'>('loading');
  const [distilling, setDistilling] = useState(false);
  const [distillMessage, setDistillMessage] = useState<string | null>(null);
  const [decidingId, setDecidingId] = useState<string | null>(null);

  const load = useCallback(() => {
    return fetch(`/api/verticals/${verticalId}/insights`)
      .then(res => res.json())
      .then(json => {
        setMigrated(json.migrated !== false);
        setInsights(json.insights ?? null);
        setExtractedCalls(json.extractedCalls ?? 0);
        setProposals(json.proposals ?? []);
        setStatus('done');
      })
      .catch(() => setStatus('error'));
  }, [verticalId]);

  useEffect(() => {
    load();
  }, [load]);

  async function onDistill() {
    setDistilling(true);
    setDistillMessage(null);
    try {
      const res = await fetch(`/api/verticals/${verticalId}/distill`, { method: 'POST' });
      const json = await res.json();
      if (!json.distilled) {
        setDistillMessage(json.reason ?? 'Could not propose updates.');
        return;
      }
      setDistillMessage(json.count > 0 ? `Proposed ${json.count} update${json.count === 1 ? '' : 's'}.` : 'No new updates to propose.');
      await load();
    } finally {
      setDistilling(false);
    }
  }

  async function onDecide(id: string, approve: boolean) {
    setDecidingId(id);
    try {
      await fetch(`/api/proposals/${id}/decide`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approve }),
      });
      setProposals(list => list.filter(p => p.id !== id));
    } finally {
      setDecidingId(null);
    }
  }

  if (status === 'loading') return <p className="text-sm text-zinc-500">Loading insights…</p>;
  if (status === 'error') return <p className="text-sm text-red-600 dark:text-red-400">Could not load insights.</p>;

  return (
    <section className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold">Insights</h2>
        <p className="mt-1 text-sm text-zinc-500">Patterns mined from {extractedCalls} extracted call(s).</p>
      </div>

      {!migrated && (
        <div className={amberBannerClass}>Run migration 0003 first — insights are not set up yet.</div>
      )}

      {insights && (
        <div className="flex flex-col gap-4">
          <Panel title="Top objections">
            {insights.topObjections.length === 0 ? (
              <p className="text-sm text-zinc-500">Not enough extracted calls yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-max text-sm">
                  <thead>
                    <tr className="text-left text-zinc-500">
                      <th className="pr-4 font-medium">Objection</th>
                      <th className="pr-4 font-medium">Count</th>
                      <th className="font-medium">% of calls</th>
                    </tr>
                  </thead>
                  <tbody>
                    {insights.topObjections.map(o => (
                      <tr key={o.objection} className="border-t border-zinc-100 dark:border-zinc-900">
                        <td className="py-1 pr-4">{o.objection}</td>
                        <td className="py-1 pr-4">{o.count}</td>
                        <td className="py-1">{o.pct}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>

          <Panel title="Top customer questions">
            {insights.topQuestions.length === 0 ? (
              <p className="text-sm text-zinc-500">Not enough extracted calls yet.</p>
            ) : (
              <ul className="list-disc pl-5 text-sm">
                {insights.topQuestions.map((q, i) => (
                  <li key={i}>
                    {q.question} <span className="text-zinc-500">({q.count})</span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Panel title="What worked">
              {insights.topWhatWorked.length === 0 ? (
                <p className="text-sm text-zinc-500">Not enough data yet.</p>
              ) : (
                <ul className="list-disc pl-5 text-sm">
                  {insights.topWhatWorked.map((w, i) => (
                    <li key={i}>
                      {w.item} <span className="text-zinc-500">({w.count})</span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
            <Panel title="What failed">
              {insights.topWhatFailed.length === 0 ? (
                <p className="text-sm text-zinc-500">Not enough data yet.</p>
              ) : (
                <ul className="list-disc pl-5 text-sm">
                  {insights.topWhatFailed.map((w, i) => (
                    <li key={i}>
                      {w.item} <span className="text-zinc-500">({w.count})</span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>

          <Panel title="Price talk">
            {insights.samplePriceTalk.length === 0 ? (
              <p className="text-sm text-zinc-500">Not enough data yet.</p>
            ) : (
              <ul className="list-disc pl-5 text-sm">
                {insights.samplePriceTalk.map((p, i) => (
                  <li key={i}>{p}</li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      )}

      {/* Anchor for /analytics's "view proposals" link — always rendered
          (unlike the pending-proposals list below) so the link lands
          somewhere even when this vertical has none pending right now. */}
      <div id="proposals" className="flex flex-wrap items-center gap-3">
        <button onClick={onDistill} disabled={distilling} className={primaryButtonClass}>
          {distilling ? 'Proposing…' : 'Propose playbook updates'}
        </button>
        {distillMessage && <span className="text-sm text-zinc-500">{distillMessage}</span>}
      </div>

      {proposals.length > 0 && (
        <div className="flex flex-col gap-3">
          <h3 className="text-sm font-semibold">Pending proposals</h3>
          {proposals.map(p => (
            <div key={p.id} className="flex flex-col gap-2 rounded-md border border-zinc-200 p-4 dark:border-zinc-800">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium capitalize">
                  {p.kind} — {p.section}
                </span>
              </div>
              <div className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
                <div className="rounded-md bg-red-50 p-2 dark:bg-red-950/40">
                  <p className="text-xs font-medium text-red-700 dark:text-red-400">Before</p>
                  <p>{renderValue(p.currentValue)}</p>
                </div>
                <div className="rounded-md bg-green-50 p-2 dark:bg-green-950/40">
                  <p className="text-xs font-medium text-green-700 dark:text-green-400">After</p>
                  <p>{renderValue(p.proposedValue)}</p>
                </div>
              </div>
              <p className="text-sm text-zinc-500">{p.evidence}</p>
              <div className="flex gap-3">
                <button
                  onClick={() => onDecide(p.id, true)}
                  disabled={decidingId === p.id}
                  className={primaryButtonClass}
                >
                  Approve
                </button>
                <button
                  onClick={() => onDecide(p.id, false)}
                  disabled={decidingId === p.id}
                  className={secondaryButtonClass}
                >
                  Reject
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

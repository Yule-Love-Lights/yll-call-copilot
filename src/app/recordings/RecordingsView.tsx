'use client';

// The recordings pipeline view (Workstream 1): last-sync time, counts by
// status, the last 50 recordings with status/skip_reason/outcome, and a
// "Process next batch" button. Talks to GET /api/recordings and
// POST /api/recordings/continue.

import { useCallback, useEffect, useState } from 'react';

type Recording = {
  id: string;
  ghlContactId: string | null;
  direction: string | null;
  calledAt: string | null;
  durationSeconds: number | null;
  status: 'pending' | 'processing' | 'transcribed' | 'skipped' | 'failed';
  skipReason: string | null;
  transcriptId: string | null;
  outcome: string | null;
  createdAt: string;
};

type Counts = { pending: number; processing: number; transcribed: number; skipped: number; failed: number };

type RecordingsResponse = {
  configured: boolean;
  migrated?: boolean;
  reason?: string;
  error?: string;
  lastSyncedAt?: string | null;
  counts?: Counts;
  recordings?: Recording[];
};

const amberBannerClass =
  'rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200';
const primaryButtonClass =
  'rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300';
const cardClass = 'flex flex-col gap-1 rounded-md border border-zinc-200 p-3 dark:border-zinc-800';

function StatTile({ label, value }: { label: string; value: number }) {
  return (
    <div className={cardClass}>
      <span className="text-xs font-medium uppercase text-zinc-500">{label}</span>
      <span className="text-2xl font-semibold">{value}</span>
    </div>
  );
}

function statusBadgeClass(status: Recording['status']): string {
  if (status === 'transcribed') return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300';
  if (status === 'failed') return 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300';
  if (status === 'skipped') return 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300';
  if (status === 'processing') return 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300';
  return 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'; // pending
}

function formatDuration(seconds: number | null): string {
  if (seconds == null) return '—';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export default function RecordingsView() {
  const [data, setData] = useState<RecordingsResponse | null>(null);
  const [status, setStatus] = useState<'loading' | 'done' | 'error'>('loading');
  const [processing, setProcessing] = useState(false);
  const [processMessage, setProcessMessage] = useState<string | null>(null);

  const load = useCallback(() => {
    return fetch('/api/recordings')
      .then(res => res.json())
      .then((json: RecordingsResponse) => {
        setData(json);
        setStatus('done');
      })
      .catch(() => setStatus('error'));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function onProcessBatch() {
    setProcessing(true);
    setProcessMessage(null);
    try {
      const res = await fetch('/api/recordings/continue', { method: 'POST' });
      const json = await res.json();
      if (json.error) {
        setProcessMessage(json.error);
        return;
      }
      if (json.migrated === false || json.configured === false) {
        setProcessMessage(json.reason ?? 'Could not process the batch.');
        return;
      }
      setProcessMessage(`Processed ${json.done} transcribed, ${json.skipped} skipped, ${json.failed} failed.`);
      await load();
    } catch {
      setProcessMessage('Could not process the batch.');
    } finally {
      setProcessing(false);
    }
  }

  if (status === 'loading') return <p className="text-sm text-zinc-500">Loading…</p>;
  if (status === 'error') return <p className="text-sm text-red-600 dark:text-red-400">Could not load recordings.</p>;

  if (!data?.migrated) {
    return <div className={amberBannerClass}>{data?.reason ?? 'Run migration 0007 first.'}</div>;
  }
  if (data.error) {
    return <div className={amberBannerClass}>{data.error}</div>;
  }

  const counts = data.counts ?? { pending: 0, processing: 0, transcribed: 0, skipped: 0, failed: 0 };
  const recordings = data.recordings ?? [];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Call recordings</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Nightly-synced GHL call recordings feeding the transcript pipeline.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button onClick={onProcessBatch} disabled={processing} className={primaryButtonClass}>
          {processing ? 'Processing…' : 'Process next batch'}
        </button>
        <span className="text-sm text-zinc-500">
          {data.lastSyncedAt ? `Last synced ${new Date(data.lastSyncedAt).toLocaleString()}` : 'Never synced yet'}
        </span>
        {processMessage && <span className="text-sm text-zinc-500">{processMessage}</span>}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <StatTile label="Pending" value={counts.pending} />
        <StatTile label="Processing" value={counts.processing} />
        <StatTile label="Transcribed" value={counts.transcribed} />
        <StatTile label="Skipped" value={counts.skipped} />
        <StatTile label="Failed" value={counts.failed} />
      </div>

      {recordings.length === 0 ? (
        <p className="text-sm text-zinc-500">No recordings synced yet.</p>
      ) : (
        <ul className="divide-y divide-zinc-200 rounded-md border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
          {recordings.map(r => (
            <li key={r.id} className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-col gap-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${statusBadgeClass(r.status)}`}>
                    {r.status}
                  </span>
                  {r.outcome && r.outcome !== 'unknown' && (
                    <span className="rounded-full border border-zinc-300 px-2 py-0.5 text-xs text-zinc-600 dark:border-zinc-700 dark:text-zinc-400">
                      {r.outcome}
                    </span>
                  )}
                  {r.skipReason && (
                    <span className="text-xs text-zinc-400">({r.skipReason})</span>
                  )}
                </div>
                <span className="text-xs text-zinc-400">
                  {r.calledAt ? new Date(r.calledAt).toLocaleString() : 'no call time'} · {formatDuration(r.durationSeconds)}
                  {r.direction ? ` · ${r.direction}` : ''}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

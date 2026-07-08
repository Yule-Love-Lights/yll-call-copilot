'use client';

// "Transcripts" section on /verticals/[id]: shows the vertical's call
// counts by outcome, a bulk-upload form (.txt/.csv/.zip, vertical implicit
// from the page, a match-outcomes checkbox default on), and a job progress
// bar. Upload kicks off POST /api/ingest/transcripts; while the job isn't
// done the UI keeps POSTing /api/ingest/continue and polling
// GET /api/ingest/jobs/[id] for the progress bar, until `remaining` is 0.

import { useCallback, useEffect, useRef, useState } from 'react';

type OutcomeCounts = { totalCalls: number; booked: number; notBooked: number; unknownOutcome: number };

type JobState = {
  jobId: string;
  total: number;
  done: number;
  failed: number;
  status: 'running' | 'done' | 'failed';
  remaining: number;
};

const inputClass =
  'rounded-md border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900';
const primaryButtonClass =
  'rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300';
const amberBannerClass =
  'rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200';

export default function TranscriptsPanel({ verticalId }: { verticalId: string }) {
  const [counts, setCounts] = useState<OutcomeCounts | null>(null);
  const [migrated, setMigrated] = useState(true);
  const [matchOutcomes, setMatchOutcomes] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [job, setJob] = useState<JobState | null>(null);
  const filesInputRef = useRef<HTMLInputElement>(null);

  const loadCounts = useCallback(() => {
    return fetch(`/api/verticals/${verticalId}/insights`)
      .then(res => res.json())
      .then(json => {
        setMigrated(json.migrated !== false);
        if (json.insights) {
          setCounts({
            totalCalls: json.insights.totalCalls,
            booked: json.insights.booked,
            notBooked: json.insights.notBooked,
            unknownOutcome: json.insights.unknownOutcome,
          });
        }
      })
      .catch(() => {});
  }, [verticalId]);

  useEffect(() => {
    loadCounts();
  }, [loadCounts]);

  // Drains an ingest job: keeps POSTing /continue while transcripts remain,
  // refreshing the progress bar from the canonical /jobs/[id] status after
  // each step (also what a second tab watching the same job would poll).
  async function driveJob(jobId: string, remainingNow: number) {
    let remaining = remainingNow;
    while (remaining > 0) {
      const res = await fetch('/api/ingest/continue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId }),
      });
      const json = await res.json();
      remaining = json.remaining ?? 0;

      const statusRes = await fetch(`/api/ingest/jobs/${jobId}`);
      const statusJson = await statusRes.json();
      if (statusJson.job) {
        setJob({
          jobId,
          total: statusJson.job.total,
          done: statusJson.job.done,
          failed: statusJson.job.failed,
          status: statusJson.job.status,
          remaining: statusJson.job.remaining,
        });
      }

      if (json.status !== 'running') break;
    }
    await loadCounts();
  }

  async function onUpload(e: React.FormEvent) {
    e.preventDefault();
    const files = filesInputRef.current?.files;
    if (!files || files.length === 0) return;

    setUploading(true);
    setUploadError(null);
    setJob(null);
    try {
      const formData = new FormData();
      formData.append('vertical_id', verticalId);
      formData.append('matchOutcomes', String(matchOutcomes));
      for (const file of Array.from(files)) formData.append('files', file);

      const res = await fetch('/api/ingest/transcripts', { method: 'POST', body: formData });
      const json = await res.json();
      if (!res.ok || json.configured === false || json.error) {
        setUploadError(json.reason ?? json.error ?? 'Upload failed.');
        return;
      }
      if (json.migrated === false) {
        setUploadError(json.reason ?? 'Run migration 0003 first.');
        return;
      }

      if (filesInputRef.current) filesInputRef.current.value = '';
      setJob({
        jobId: json.jobId,
        total: json.total,
        done: json.done,
        failed: json.failed,
        status: json.status,
        remaining: json.remaining,
      });

      if (json.status === 'running' && json.remaining > 0) {
        await driveJob(json.jobId, json.remaining);
      } else {
        await loadCounts();
      }
    } finally {
      setUploading(false);
    }
  }

  const pct = job && job.total > 0 ? Math.round(((job.done + job.failed) / job.total) * 100) : 0;

  return (
    <section className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold">Transcripts</h2>
        <p className="mt-1 text-sm text-zinc-500">
          Bulk-upload past call transcripts to mine objections, questions, and what worked.
        </p>
      </div>

      {!migrated && (
        <div className={amberBannerClass}>Run migration 0003 first — transcript ingest is not set up yet.</div>
      )}

      {counts && (
        <div className="flex flex-wrap gap-4 text-sm">
          <span className="text-zinc-500">
            {counts.totalCalls} call{counts.totalCalls === 1 ? '' : 's'}
          </span>
          <span className="text-green-700 dark:text-green-400">{counts.booked} booked</span>
          <span className="text-red-700 dark:text-red-400">{counts.notBooked} not booked</span>
          <span className="text-zinc-500">{counts.unknownOutcome} unknown</span>
        </div>
      )}

      <form onSubmit={onUpload} className="flex flex-col gap-3 rounded-md border border-zinc-200 p-4 dark:border-zinc-800">
        <label className="text-sm font-semibold" htmlFor="transcript-files">
          Transcript files (.txt, .csv, or a .zip of either)
        </label>
        <input
          id="transcript-files"
          ref={filesInputRef}
          type="file"
          accept=".txt,.csv,.zip"
          multiple
          className={inputClass}
        />
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={matchOutcomes}
            onChange={e => setMatchOutcomes(e.target.checked)}
          />
          Match outcomes against GoHighLevel
        </label>
        <button type="submit" disabled={uploading} className={`self-start ${primaryButtonClass}`}>
          {uploading ? 'Uploading…' : 'Upload and process'}
        </button>
      </form>
      {uploadError && <p className="text-sm text-red-600 dark:text-red-400">{uploadError}</p>}

      {job && (
        <div className="flex flex-col gap-2">
          <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
            <div
              className="h-2 rounded-full bg-zinc-900 transition-all dark:bg-zinc-100"
              style={{ width: `${pct}%` }}
            />
          </div>
          <p className="text-sm text-zinc-500">
            {job.done + job.failed} of {job.total} processed ({job.failed} failed) — {job.status}
          </p>
        </div>
      )}
    </section>
  );
}

'use client';

// The second-mile task queue: a "First cold snap tonight?" button, a
// December banner while the cookies+ornament window is open, and every
// touch grouped by kind with Done/Skip and (for reveal_photo/
// cold_snap_checkin) Draft + Send. Talks to GET /api/second-mile,
// POST /api/second-mile/cold-snap, and the per-touch decide/draft/send
// routes. Style matches src/app/queue/QueueList.tsx.

import { useCallback, useEffect, useState } from 'react';

type TouchKind = 'reveal_photo' | 'personal_touch' | 'cookies_ornament' | 'cold_snap_checkin';
type TouchStatus = 'pending' | 'done' | 'skipped';

type Touch = {
  id: string;
  ghlContactId: string | null;
  customerName: string | null;
  kind: TouchKind;
  status: TouchStatus;
  dueAt: string | null;
  payload: Record<string, unknown> | null;
  createdAt: string;
  doneAt: string | null;
  doneBy: string | null;
};

type ListResponse = {
  configured: boolean;
  migrated?: boolean;
  reason?: string;
  sendEnabled?: boolean;
  cookiesOrnamentWindowActive?: boolean;
  touches: Touch[];
};

const KIND_LABELS: Record<TouchKind, string> = {
  reveal_photo: 'Reveal photos',
  personal_touch: 'Personal touches',
  cookies_ornament: 'Cookies + ornament',
  cold_snap_checkin: 'Cold snap check-ins',
};

const KIND_ORDER: TouchKind[] = ['reveal_photo', 'personal_touch', 'cookies_ornament', 'cold_snap_checkin'];
const SENDABLE_KINDS = new Set<TouchKind>(['reveal_photo', 'cold_snap_checkin']);

const amberBannerClass =
  'rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200';
const primaryButtonClass =
  'rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300';
const secondaryButtonClass =
  'rounded-md border border-zinc-300 px-3 py-1 text-sm hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-900';

function ageLabel(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const hours = Math.floor(ms / (60 * 60 * 1000));
  if (hours < 1) return 'just now';
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function detailText(t: Touch): string {
  if (t.kind === 'personal_touch') return (t.payload?.detail as string | undefined) ?? '(no detail)';
  if (t.kind === 'reveal_photo') {
    const address = t.payload?.address as string | null | undefined;
    return address ? address : '(no address on file)';
  }
  if (t.kind === 'cookies_ornament') return 'Fulfill cookies + custom home ornament';
  return 'Send the check-in';
}

function TouchRow({
  touch,
  sendEnabled,
  acting,
  onDecide,
  onDraft,
  onSend,
}: {
  touch: Touch;
  sendEnabled: boolean;
  acting: boolean;
  onDecide: (action: 'done' | 'skip') => void;
  onDraft: () => void;
  onSend: () => void;
}) {
  const draftBody = touch.payload?.draftBody as string | undefined;
  const sendable = SENDABLE_KINDS.has(touch.kind);

  return (
    <li className="flex flex-col gap-2 px-4 py-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">{touch.customerName ?? '(no name)'}</span>
            <span className="text-xs text-zinc-400">{ageLabel(touch.createdAt)}</span>
          </div>
          <span className="text-sm text-zinc-500">{detailText(touch)}</span>
        </div>
        {touch.status === 'pending' && (
          <div className="flex shrink-0 gap-2">
            {sendable && (
              <>
                <button onClick={onDraft} disabled={acting} className={secondaryButtonClass}>
                  {acting ? '…' : 'Draft'}
                </button>
                <button
                  onClick={onSend}
                  disabled={acting || !sendEnabled || !draftBody}
                  title={!sendEnabled ? 'Sending disabled - set GHL_SEND_ENABLED=true' : !draftBody ? 'Draft a message first' : undefined}
                  className={secondaryButtonClass}
                >
                  Send
                </button>
              </>
            )}
            <button onClick={() => onDecide('done')} disabled={acting} className={secondaryButtonClass}>
              Done
            </button>
            <button onClick={() => onDecide('skip')} disabled={acting} className={secondaryButtonClass}>
              Skip
            </button>
          </div>
        )}
        {touch.status !== 'pending' && (
          <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
            {touch.status === 'done' ? 'Done' : 'Skipped'}
          </span>
        )}
      </div>
      {draftBody && touch.status === 'pending' && (
        <p className="whitespace-pre-wrap rounded-md bg-zinc-50 p-2 text-xs text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
          {draftBody}
        </p>
      )}
    </li>
  );
}

export default function SecondMileQueue() {
  const [touches, setTouches] = useState<Touch[]>([]);
  const [migrated, setMigrated] = useState(true);
  const [reason, setReason] = useState<string | null>(null);
  const [sendEnabled, setSendEnabled] = useState(false);
  const [windowActive, setWindowActive] = useState(false);
  const [status, setStatus] = useState<'loading' | 'done' | 'error'>('loading');
  const [actingId, setActingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [queuingColdSnap, setQueuingColdSnap] = useState(false);
  const [coldSnapMessage, setColdSnapMessage] = useState<string | null>(null);

  const load = useCallback(() => {
    return fetch('/api/second-mile')
      .then(res => res.json())
      .then((json: ListResponse) => {
        setMigrated(json.migrated !== false);
        setReason(json.reason ?? null);
        setSendEnabled(!!json.sendEnabled);
        setWindowActive(!!json.cookiesOrnamentWindowActive);
        setTouches(json.touches ?? []);
        setStatus('done');
      })
      .catch(() => setStatus('error'));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function onColdSnap() {
    setQueuingColdSnap(true);
    setColdSnapMessage(null);
    try {
      const res = await fetch('/api/second-mile/cold-snap', { method: 'POST' });
      const json = await res.json();
      if (json.error) {
        setColdSnapMessage(json.error);
      } else if (json.configured === false || json.reason) {
        setColdSnapMessage(json.reason ?? 'Could not queue check-ins.');
      } else {
        setColdSnapMessage(`Queued ${json.created} check-in(s).`);
        await load();
      }
    } catch {
      setColdSnapMessage('Could not queue check-ins.');
    } finally {
      setQueuingColdSnap(false);
    }
  }

  async function onDecide(id: string, action: 'done' | 'skip') {
    setActingId(id);
    setActionError(null);
    try {
      const res = await fetch(`/api/second-mile/${id}/decide`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json || !json.decided) {
        setActionError(json?.reason ?? `Could not mark this ${action}.`);
      }
      await load();
    } catch {
      setActionError(`Could not mark this ${action}.`);
    } finally {
      setActingId(null);
    }
  }

  async function onDraft(id: string) {
    setActingId(id);
    setActionError(null);
    try {
      const res = await fetch(`/api/second-mile/${id}/draft`, { method: 'POST' });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json || !json.drafted) {
        setActionError(json?.error ?? json?.reason ?? 'Could not draft this message.');
      }
      await load();
    } catch {
      setActionError('Could not draft this message.');
    } finally {
      setActingId(null);
    }
  }

  async function onSend(id: string) {
    setActingId(id);
    setActionError(null);
    try {
      const res = await fetch(`/api/second-mile/${id}/send`, { method: 'POST' });
      const json = await res.json().catch(() => null);
      if (!json || json.sent !== true) {
        setActionError(json?.error ?? json?.reason ?? 'Could not send this message.');
      }
      await load();
    } catch {
      setActionError('Could not send this message.');
    } finally {
      setActingId(null);
    }
  }

  const pendingCounts = KIND_ORDER.reduce<Record<TouchKind, number>>(
    (acc, kind) => ({ ...acc, [kind]: touches.filter(t => t.kind === kind && t.status === 'pending').length }),
    {} as Record<TouchKind, number>,
  );
  const cookiesOrnamentPending = pendingCounts.cookies_ornament ?? 0;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Second mile</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Reveal photos, personal touches, the December cookies + ornament run, and cold-snap check-ins — worked as one
          queue.
        </p>
      </div>

      {!migrated && <div className={amberBannerClass}>{reason ?? 'Run migration 0013 first.'}</div>}
      {migrated && reason && <div className={amberBannerClass}>{reason}</div>}
      {windowActive && (
        <div className={amberBannerClass}>
          Cookies + ornament run is live: {cookiesOrnamentPending} to fulfill.
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button onClick={onColdSnap} disabled={queuingColdSnap} className={primaryButtonClass}>
          {queuingColdSnap ? 'Queuing…' : 'First cold snap tonight? Queue check-ins.'}
        </button>
        {coldSnapMessage && <span className="text-sm text-zinc-500">{coldSnapMessage}</span>}
      </div>

      {status === 'loading' && <p className="text-sm text-zinc-500">Loading…</p>}
      {status === 'error' && <p className="text-sm text-red-600 dark:text-red-400">Could not load the second-mile queue.</p>}
      {actionError && <p className="text-sm text-red-600 dark:text-red-400">{actionError}</p>}

      {status === 'done' && touches.length === 0 && <p className="text-sm text-zinc-500">Nothing queued yet.</p>}

      {KIND_ORDER.map(kind => {
        const kindTouches = touches.filter(t => t.kind === kind);
        if (kindTouches.length === 0) return null;
        return (
          <div key={kind}>
            <h2 className="mb-2 text-sm font-semibold">
              {KIND_LABELS[kind]}{' '}
              <span className="font-normal text-zinc-400">({pendingCounts[kind]} pending of {kindTouches.length})</span>
            </h2>
            <ul className="divide-y divide-zinc-200 rounded-md border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
              {kindTouches.map(touch => (
                <TouchRow
                  key={touch.id}
                  touch={touch}
                  sendEnabled={sendEnabled}
                  acting={actingId === touch.id}
                  onDecide={action => onDecide(touch.id, action)}
                  onDraft={() => onDraft(touch.id)}
                  onSend={() => onSend(touch.id)}
                />
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

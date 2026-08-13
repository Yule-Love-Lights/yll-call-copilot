'use client';

// Dashboard screen-pop for inbound calls/messages: polls
// GET /api/inbound/recent every 10s while the dashboard is open and shows a
// card per caller from the last 10 minutes. Unclaimed customer identity is
// redacted until the employee wins an actor-bound claim; owned/admin records
// can open the console. A dismissed card stays
// dismissed for the rest of this page load — the event itself ages out of
// the 10-minute window on its own, no server-side "seen" state needed.

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

type InboundEvent = {
  contactId: string | null;
  name: string | null;
  phone: string | null;
  leadId: string;
  pastCallsCount: number;
  openLeadReason: string | null;
  occurredAt: string;
  redacted: boolean;
  canClaim: boolean;
  canOpen: boolean;
};

function apiErrorMessage(value: unknown, fallback: string): string {
  if (typeof value === 'string' && value.trim()) return value;
  if (value && typeof value === 'object') {
    const message = (value as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim()) return message;
  }
  return fallback;
}

const POLL_MS = 10_000;

export default function InboundPop() {
  const router = useRouter();
  const [events, setEvents] = useState<InboundEvent[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [claimingId, setClaimingId] = useState<string | null>(null);
  const [claimError, setClaimError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    function poll() {
      fetch('/api/inbound/recent')
        .then(res => res.json())
        .then(json => {
          if (!cancelled) setEvents(json.events ?? []);
        })
        .catch(() => {});
    }

    poll();
    const interval = setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const visible = events.filter(e => !dismissed.has(e.leadId));
  if (visible.length === 0) return null;

  async function claim(event: InboundEvent) {
    setClaimingId(event.leadId);
    setClaimError(null);
    try {
      const response = await fetch(`/api/leads/${event.leadId}/decide`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'claim' }),
      });
      const json = await response.json().catch(() => null);
      if (!response.ok || !json?.decided) {
        setClaimError(apiErrorMessage(json?.error ?? json?.reason, 'Could not claim this inbound lead.'));
        return;
      }
      router.push(`/call/${event.leadId}`);
    } catch {
      setClaimError('Could not claim this inbound lead.');
    } finally {
      setClaimingId(null);
    }
  }

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-3">
      {visible.map(e => (
        <div
          key={e.leadId}
          className="w-80 rounded-md border border-blue-300 bg-blue-50 p-4 shadow-lg dark:border-blue-700 dark:bg-blue-950"
        >
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-sm font-semibold text-blue-900 dark:text-blue-200">Inbound call</p>
              <p className="text-sm text-blue-800 dark:text-blue-300">
                {e.redacted ? 'Claim to view caller details' : (e.name ?? '(unknown caller)')}
              </p>
              {!e.redacted && <p className="text-xs text-blue-700 dark:text-blue-400">{e.phone ?? 'no phone'}</p>}
            </div>
            <button
              type="button"
              onClick={() => setDismissed(prev => new Set(prev).add(e.leadId))}
              className="text-xs text-blue-700 hover:underline dark:text-blue-400"
            >
              Dismiss
            </button>
          </div>
          <p className="mt-2 text-xs text-blue-700 dark:text-blue-400">
            {e.pastCallsCount} past call{e.pastCallsCount === 1 ? '' : 's'}
            {e.openLeadReason ? ` · ${e.openLeadReason}` : ''}
          </p>
          <div className="mt-3 flex items-center gap-2">
            {e.canClaim && (
              <button
                type="button"
                onClick={() => claim(e)}
                disabled={claimingId === e.leadId}
                className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {claimingId === e.leadId ? 'Claiming…' : 'Claim'}
              </button>
            )}
            {e.canOpen && (
              <Link
                href={`/call/${e.leadId}`}
                className="inline-block rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
              >
                Open console →
              </Link>
            )}
          </div>
        </div>
      ))}
      {claimError && (
        <p className="w-80 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-700 dark:bg-red-950 dark:text-red-300">
          {claimError}
        </p>
      )}
    </div>
  );
}

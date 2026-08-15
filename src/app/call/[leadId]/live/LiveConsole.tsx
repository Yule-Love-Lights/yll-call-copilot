'use client';

// Live coaching is reserved for an assigned, real customer call. Practice
// conversations use /practice and never create lead, call, transcript, or
// performance records.

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

type Phase = 'loading' | 'idle' | 'starting' | 'active' | 'ending' | 'read_only';

type LeadDetailResponse = {
  error?: string;
  canWork?: boolean;
  liveCallingEnabled?: boolean;
  lead?: { fullName: string | null; phone: string | null };
  contact?: { fullName?: string; phone?: string } | null;
  liveAttempt?: {
    sessionId: string;
    callId: string;
    status: 'starting' | 'active' | 'pending_outcome';
    startedAt: string;
  } | null;
};

type CoachingEvent = {
  id: string;
  atMs: number;
  trigger: string;
  card: string;
  expanded: string | null;
  repRating: 'helpful' | 'noise' | null;
};

const POLL_INTERVAL_MS = 750;
const cardClass = 'flex flex-col gap-3 rounded-md border border-zinc-200 p-4 dark:border-zinc-800';
const primaryButtonClass =
  'rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300';
const secondaryButtonClass =
  'rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-900';

function getOrCreateStartRequestId(leadId: string): string {
  const key = `yll-live-start:${leadId}`;
  try {
    const existing = sessionStorage.getItem(key);
    if (existing) return existing;
    const created = crypto.randomUUID();
    sessionStorage.setItem(key, created);
    return created;
  } catch {
    // The SQL request remains actor-bound and rejects a different concurrent
    // logical start. Browser storage only adds lost-response recovery.
    return crypto.randomUUID();
  }
}

function clearStartRequestId(leadId: string) {
  try {
    sessionStorage.removeItem(`yll-live-start:${leadId}`);
  } catch {
    // The attempt is already active/terminal; stale browser state is harmless.
  }
}

export default function LiveConsole({ leadId }: { leadId: string }) {
  const router = useRouter();
  const [lead, setLead] = useState<{ fullName: string | null; phone: string | null } | null>(null);
  const [phase, setPhase] = useState<Phase>('loading');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [transcript, setTranscript] = useState('');
  const [events, setEvents] = useState<CoachingEvent[]>([]);
  const [cardExpanded, setCardExpanded] = useState(false);
  const [twilioUnavailable, setTwilioUnavailable] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const deviceRef = useRef<{ disconnectAll: () => void } | null>(null);
  const lastCardAtMsRef = useRef(0);

  const loadLead = useCallback(async () => {
    const response = await fetch(`/api/leads/${leadId}`);
    const json = (await response.json().catch(() => null)) as LeadDetailResponse | null;
    if (!response.ok || !json?.lead) {
      setError(json?.error ?? 'Could not load this lead.');
      setPhase('read_only');
      return;
    }
    setLead({
      fullName: json.contact?.fullName ?? json.lead.fullName,
      phone: json.contact?.phone ?? json.lead.phone,
    });
    if (json.canWork !== true) {
      setPhase('read_only');
      return;
    }
    if (json.liveCallingEnabled !== true) {
      setTwilioUnavailable(true);
      setError('Customer live calling is not available yet. Use Practice for training.');
      setPhase('read_only');
      return;
    }
    const attempt = json.liveAttempt;
    if (attempt?.status === 'pending_outcome') {
      router.replace(`/call/${leadId}`);
      return;
    }
    if (attempt?.status === 'active') {
      setSessionId(attempt.sessionId);
      setPhase('active');
      return;
    }
    if (attempt?.status === 'starting') setSessionId(attempt.sessionId);
    setPhase('idle');
  }, [leadId, router]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      loadLead().catch(() => {
        setError('Could not load this lead.');
        setPhase('read_only');
      });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadLead]);

  useEffect(() => {
    if (phase !== 'active' || !sessionId) return;
    let cancelled = false;

    async function poll() {
      try {
        const response = await fetch(`/api/live/events?sessionId=${sessionId}&afterMs=0`);
        const json = await response.json();
        if (cancelled || !response.ok) return;
        if (typeof json.transcriptRunning === 'string') setTranscript(json.transcriptRunning);
        if (Array.isArray(json.events)) {
          setEvents(json.events);
          const latest = json.events.at(-1) as CoachingEvent | undefined;
          if (latest && latest.atMs !== lastCardAtMsRef.current) {
            lastCardAtMsRef.current = latest.atMs;
            setCardExpanded(false);
          }
        }
        if (json.status === 'pending_outcome' || json.status === 'completed') {
          router.replace(`/call/${leadId}`);
        }
      } catch {
        // A missed poll retries. It must not interrupt a live call.
      }
    }

    poll();
    const interval = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [leadId, phase, router, sessionId]);

  async function startTwilio(token: string, dialGrant: string) {
    const { Device } = await import('@twilio/voice-sdk');
    const device = new Device(token, {});
    deviceRef.current = device;
    await device.register();
    await device.connect({ params: { dialGrant } });
  }

  async function abandonStartingAttempt(id: string): Promise<boolean> {
    const response = await fetch('/api/live/abort', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: id }),
    });
    return response.ok;
  }

  async function onStart() {
    setError(null);
    setTwilioUnavailable(false);
    setPhase('starting');
    setTranscript('');
    setEvents([]);
    lastCardAtMsRef.current = 0;

    let startedSessionId: string | null = null;
    try {
      const tokenResponse = await fetch('/api/twilio/token');
      const tokenJson = await tokenResponse.json().catch(() => null);
      if (!tokenResponse.ok || tokenJson?.configured === false || typeof tokenJson?.token !== 'string') {
        setTwilioUnavailable(true);
        throw new Error(tokenJson?.error ?? 'Live calling is not configured. Use Practice for training.');
      }

      const startRequestId = getOrCreateStartRequestId(leadId);
      const startResponse = await fetch('/api/live/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leadId, startRequestId }),
      });
      const startJson = await startResponse.json().catch(() => null);
      if (!startResponse.ok || !startJson?.saved) {
        throw new Error(startJson?.error ?? startJson?.reason ?? 'Could not start the call.');
      }
      startedSessionId = startJson.sessionId;
      setSessionId(startedSessionId);

      if (startJson.status === 'pending_outcome') {
        clearStartRequestId(leadId);
        router.replace(`/call/${leadId}`);
        return;
      }
      if (startJson.status === 'active') {
        clearStartRequestId(leadId);
        setPhase('active');
        return;
      }
      if (typeof startJson.dialGrant !== 'string') {
        throw new Error('The dial authorization is missing.');
      }

      await startTwilio(tokenJson.token, startJson.dialGrant);
      clearStartRequestId(leadId);
      setPhase('active');
    } catch (caught) {
      if (startedSessionId) {
        const abandoned = await abandonStartingAttempt(startedSessionId).catch(() => false);
        if (!abandoned) {
          // The dial may have crossed into active while the browser reported a
          // connection error. Preserve the attempt so it can be ended safely.
          setSessionId(startedSessionId);
          setPhase('active');
        } else {
          clearStartRequestId(leadId);
          setSessionId(null);
          setPhase('idle');
        }
      } else {
        setPhase('idle');
      }
      setError(caught instanceof Error ? caught.message : 'Could not start the call.');
    }
  }

  async function onEnd() {
    if (!sessionId) return;
    setError(null);
    setPhase('ending');
    deviceRef.current?.disconnectAll();
    deviceRef.current = null;

    try {
      const response = await fetch('/api/live/end', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      });
      const json = await response.json().catch(() => null);
      if (!response.ok || !json?.saved) {
        setError(json?.error ?? 'Could not end the call. Try again before leaving this screen.');
        setPhase('active');
        return;
      }
      router.push(`/call/${leadId}`);
    } catch {
      setError('Could not end the call. Check your connection and try again before leaving this screen.');
      setPhase('active');
    }
  }

  async function onRate(eventId: string, rating: 'helpful' | 'noise') {
    setEvents(previous => previous.map(event => (event.id === eventId ? { ...event, repRating: rating } : event)));
    await fetch(`/api/coaching/${eventId}/rate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rating }),
    }).catch(() => {});
  }

  const latestEvent = events.at(-1) ?? null;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Live coaching</h1>
        <p className="mt-1 text-sm text-zinc-500">
          {lead?.fullName ?? 'This lead'}
          {lead?.phone ? ` · ${lead.phone}` : ''}
        </p>
      </div>

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      {twilioUnavailable && (
        <Link href="/practice" className="self-start text-sm text-blue-600 hover:underline dark:text-blue-400">
          Open Practice instead →
        </Link>
      )}

      {phase === 'loading' && <p className="text-sm text-zinc-500">Loading…</p>}
      {phase === 'read_only' && (
        <div className={cardClass}>
          <p className="text-sm text-zinc-500">
            {twilioUnavailable
              ? 'Customer live calling is not available yet.'
              : 'Only the employee assigned to this lead can start, resume, or end its call.'}
          </p>
        </div>
      )}
      {phase === 'idle' && (
        <div className={cardClass}>
          <p className="text-sm text-zinc-500">This starts a real customer call. Training conversations belong in Practice.</p>
          <button onClick={onStart} className={`self-start ${primaryButtonClass}`}>
            {sessionId ? 'Resume call setup' : 'Start coached call'}
          </button>
        </div>
      )}
      {phase === 'starting' && <p className="text-sm text-zinc-500">Starting…</p>}

      {(phase === 'active' || phase === 'ending') && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.2fr_1fr]">
          <section className={cardClass}>
            <h2 className="text-sm font-semibold">Live transcript</h2>
            <pre className="max-h-96 overflow-y-auto whitespace-pre-wrap font-sans text-sm text-zinc-700 dark:text-zinc-300">
              {transcript || 'Waiting for the call to start talking…'}
            </pre>
            <button onClick={onEnd} disabled={phase === 'ending'} className={`self-start ${secondaryButtonClass}`}>
              {phase === 'ending' ? 'Ending…' : 'End call'}
            </button>
          </section>

          <section className={cardClass}>
            <h2 className="text-sm font-semibold">Coach</h2>
            {!latestEvent && <p className="text-sm text-zinc-500">No coaching cards yet.</p>}
            {latestEvent && (
              <div className="flex flex-col gap-3 rounded-md border border-zinc-300 p-4 dark:border-zinc-700">
                <button onClick={() => setCardExpanded(value => !value)} className="text-left text-lg font-semibold">
                  {latestEvent.card}
                </button>
                {cardExpanded && latestEvent.expanded && (
                  <p className="text-sm text-zinc-600 dark:text-zinc-400">{latestEvent.expanded}</p>
                )}
                <div className="flex gap-2">
                  <button onClick={() => onRate(latestEvent.id, 'helpful')} className={secondaryButtonClass}>Helpful</button>
                  <button onClick={() => onRate(latestEvent.id, 'noise')} className={secondaryButtonClass}>Noise</button>
                </div>
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

'use client';

// Phase 4 live coaching console. "Start coached call" decides the mode at
// click time: Twilio if GET /api/twilio/token reports configured (no
// account exists yet, so this is normally false), otherwise the simulator
// (always available). Either way the transcript pane and coaching card are
// driven by the SAME 2s poll against GET /api/live/events -- the simulator
// posts fake lines through the real POST /api/live/segment endpoint, so the
// cards it produces are real (real engine, real Claude call), only the
// audio is fake. No websockets, per the brief.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { SIMULATOR_SCRIPTS, getSimulatorScript } from '@/lib/live/simulator';

type Phase = 'idle' | 'starting' | 'active' | 'ending';
type Mode = 'twilio' | 'simulator';

type LeadSummary = { fullName: string | null; phone: string | null };

type CoachingEvent = {
  id: string;
  atMs: number;
  trigger: string;
  card: string;
  expanded: string | null;
  repRating: 'helpful' | 'noise' | null;
};

// 750ms, not 2s: a coaching card that lands 2 seconds after the customer
// speaks is too late to use mid-sentence. This is the single biggest lever on
// perceived latency. It drives both the transcript pane and the cards, and at
// a handful of concurrent reps the extra serverless polls are cheap.
const POLL_INTERVAL_MS = 750;

const cardClass = 'flex flex-col gap-3 rounded-md border border-zinc-200 p-4 dark:border-zinc-800';
const primaryButtonClass =
  'rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300';
const secondaryButtonClass =
  'rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-900';
const selectClass = 'rounded-md border border-zinc-300 px-2 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-900';

export default function LiveConsole({ leadId }: { leadId: string }) {
  const router = useRouter();

  const [lead, setLead] = useState<LeadSummary | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [mode, setMode] = useState<Mode | null>(null);
  const [scriptId, setScriptId] = useState(SIMULATOR_SCRIPTS[0].id);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [transcript, setTranscript] = useState('');
  const [events, setEvents] = useState<CoachingEvent[]>([]);
  const [cardExpanded, setCardExpanded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  // Untyped ref: @twilio/voice-sdk is dynamically imported only in Twilio
  // mode (no account exists yet), so its type is not imported at module
  // scope -- see startTwilio().
  const deviceRef = useRef<{ disconnectAll: () => void } | null>(null);
  const lastCardAtMsRef = useRef(0);

  useEffect(() => {
    fetch(`/api/leads/${leadId}`)
      .then(res => res.json())
      .then((json: { lead?: { fullName: string | null; phone: string | null }; contact?: { fullName?: string; phone?: string } }) => {
        if (json.lead) {
          setLead({
            fullName: json.contact?.fullName ?? json.lead.fullName,
            phone: json.contact?.phone ?? json.lead.phone,
          });
        }
      })
      .catch(() => {});
  }, [leadId]);

  const clearTimers = useCallback(() => {
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];
  }, []);
  useEffect(() => clearTimers, [clearTimers]);

  // Poll loop: the one source of truth for both the transcript pane and the
  // coaching card, for either mode.
  useEffect(() => {
    if (phase !== 'active' || !sessionId) return;
    let cancelled = false;

    async function poll() {
      try {
        const res = await fetch(`/api/live/events?sessionId=${sessionId}&afterMs=0`);
        const json = await res.json();
        if (cancelled || !json.configured) return;
        if (typeof json.transcriptRunning === 'string') setTranscript(json.transcriptRunning);
        if (Array.isArray(json.events)) {
          setEvents(json.events);
          const latest = json.events.at(-1) as CoachingEvent | undefined;
          if (latest && latest.atMs !== lastCardAtMsRef.current) {
            lastCardAtMsRef.current = latest.atMs;
            setCardExpanded(false);
          }
        }
      } catch {
        // A missed poll just retries in POLL_INTERVAL_MS -- not worth
        // surfacing as an error mid-call.
      }
    }

    poll();
    const interval = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [phase, sessionId]);

  function startSimulator(newSessionId: string) {
    const script = getSimulatorScript(scriptId) ?? SIMULATOR_SCRIPTS[0];
    script.exchanges.forEach(exchange => {
      const timer = setTimeout(() => {
        fetch('/api/live/segment', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sessionId: newSessionId,
            speaker: exchange.speaker,
            text: exchange.text,
            silenceMs: exchange.silenceMs,
          }),
        }).catch(() => {});
      }, exchange.atMs);
      timersRef.current.push(timer);
    });
  }

  // UNTESTED against a live account -- see src/lib/live/twilioVoice.ts.
  async function startTwilio(token: string, dialGrant: string) {
    const { Device } = await import('@twilio/voice-sdk');
    const device = new Device(token, {});
    deviceRef.current = device;
    await device.register();
    // The destination and session are resolved server-side from this opaque,
    // one-time grant. Never send a customer number as a caller-controlled
    // Twilio parameter.
    await device.connect({ params: { dialGrant } });
  }

  async function onStart() {
    setError(null);
    setPhase('starting');
    setTranscript('');
    setEvents([]);
    lastCardAtMsRef.current = 0;

    try {
      const tokenRes = await fetch('/api/twilio/token');
      const tokenJson = await tokenRes.json();
      if (!tokenRes.ok) {
        throw new Error(tokenJson.error ?? 'Could not authorize the phone client.');
      }
      const chosenMode: Mode = tokenJson.configured ? 'twilio' : 'simulator';

      const startRes = await fetch('/api/live/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leadId, mode: chosenMode }),
      });
      const startJson = await startRes.json();
      if (!startJson.saved) {
        setError(startJson.error ?? startJson.reason ?? 'Could not start the call.');
        setPhase('idle');
        return;
      }

      setMode(chosenMode);
      setSessionId(startJson.sessionId);
      setPhase('active');

      if (chosenMode === 'twilio') {
        if (!startJson.dialGrant) throw new Error('The dial authorization is missing.');
        await startTwilio(tokenJson.token, startJson.dialGrant);
      } else {
        startSimulator(startJson.sessionId);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start the call.');
      setPhase('idle');
    }
  }

  async function onEnd() {
    clearTimers();
    if (deviceRef.current) {
      deviceRef.current.disconnectAll();
      deviceRef.current = null;
    }
    setPhase('ending');
    // Carry the call id this session was anchored to back to the outcome
    // console so it updates that same row instead of the console inserting
    // a second `calls` row for this conversation (see POST /api/calls).
    let callId: string | null = null;
    try {
      if (sessionId) {
        const res = await fetch('/api/live/end', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId }),
        });
        const json = await res.json().catch(() => null);
        callId = typeof json?.callId === 'string' ? json.callId : null;
      }
    } finally {
      router.push(callId ? `/call/${leadId}?callId=${callId}` : `/call/${leadId}`);
    }
  }

  async function onRate(eventId: string, rating: 'helpful' | 'noise') {
    setEvents(prev => prev.map(e => (e.id === eventId ? { ...e, repRating: rating } : e)));
    try {
      await fetch(`/api/coaching/${eventId}/rate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rating }),
      });
    } catch {
      // Best-effort -- the optimistic update above already reflects the tap.
    }
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

      {phase === 'idle' && (
        <div className={cardClass}>
          <label className="flex flex-wrap items-center gap-2 text-sm text-zinc-500">
            Simulator script (used only if Twilio is not configured)
            <select value={scriptId} onChange={e => setScriptId(e.target.value)} className={selectClass}>
              {SIMULATOR_SCRIPTS.map(s => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          <button onClick={onStart} className={`self-start ${primaryButtonClass}`}>
            Start coached call
          </button>
        </div>
      )}

      {phase === 'starting' && <p className="text-sm text-zinc-500">Starting…</p>}

      {(phase === 'active' || phase === 'ending') && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.2fr_1fr]">
          <section className={cardClass}>
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold">Live transcript</h2>
              {mode === 'simulator' && (
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                  SIMULATION
                </span>
              )}
            </div>
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
                <button onClick={() => setCardExpanded(v => !v)} className="text-left text-lg font-semibold">
                  {latestEvent.card}
                </button>
                {cardExpanded && latestEvent.expanded && (
                  <p className="text-sm text-zinc-600 dark:text-zinc-400">{latestEvent.expanded}</p>
                )}
                <div className="flex gap-2">
                  <button
                    onClick={() => onRate(latestEvent.id, 'helpful')}
                    className={`${secondaryButtonClass} ${
                      latestEvent.repRating === 'helpful' ? 'border-green-500 text-green-700 dark:text-green-400' : ''
                    }`}
                  >
                    Helpful
                  </button>
                  <button
                    onClick={() => onRate(latestEvent.id, 'noise')}
                    className={`${secondaryButtonClass} ${
                      latestEvent.repRating === 'noise' ? 'border-red-500 text-red-700 dark:text-red-400' : ''
                    }`}
                  >
                    Noise
                  </button>
                </div>
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

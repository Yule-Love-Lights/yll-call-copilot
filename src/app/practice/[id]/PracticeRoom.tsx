'use client';

// The live practice room: loads the session (GET /api/practice/[id]),
// speaks/shows each AI-customer line, takes the rep's next line by voice
// (Web Speech API, push-to-talk, feature-detected) or typing, and on "End
// and score" renders the practice feedback card -- reusing the exact same
// card visual the real feedback feed uses (src/app/coach/CardSections.tsx)
// via the same deriveCard() the feed's cards are built from
// (src/lib/feedback/card.ts). Voice is entirely client-side and free
// (browser-native SpeechRecognition + speechSynthesis); no server audio
// path exists for practice.
//
// Ambient SpeechRecognition types below: TypeScript's DOM lib ships
// SpeechSynthesis (used for the customer's spoken voice) but NOT
// SpeechRecognition, which is still non-standard -- declared inline here,
// the one consumer, rather than as a project-wide .d.ts.

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { deriveCard, isPraiseOnly } from '@/lib/feedback/card';
import type { CallScoreContent } from '@/lib/scoring/types';
import type { CallScoreRow } from '@/lib/feedback/types';
import { bannerClass, CardDetails, CardWinBlock, type Guarantees } from '../../coach/CardSections';

type SpeechRecognitionResultLike = { transcript: string };
type SpeechRecognitionEventLike = { results: ArrayLike<ArrayLike<SpeechRecognitionResultLike>> };

interface SpeechRecognitionInstance {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start(): void;
  stop(): void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionInstance;

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  }
}

type PracticeTurn = { speaker: 'rep' | 'customer'; text: string; at: string };

type SessionResponse = {
  configured: boolean;
  migrated?: boolean;
  reason?: string;
  error?: string;
  session: {
    id: string;
    verticalSlug: string | null;
    emotionalState: string;
    objective: string | null;
    turns: PracticeTurn[];
    status: 'active' | 'ended';
    score: CallScoreContent | null;
    createdAt: string;
    endedAt: string | null;
  } | null;
};

type EndResponse = {
  configured: boolean;
  saved: boolean;
  scored?: boolean;
  score?: CallScoreContent;
  reason?: string;
  error?: string;
};

const primaryButtonClass =
  'inline-flex min-h-[44px] items-center justify-center rounded-full bg-[var(--brand-evergreen)] px-6 text-sm font-bold text-[var(--brand-cream)] shadow-[0_2px_10px_rgba(11,20,15,0.25)] disabled:opacity-50';
const secondaryButtonClass =
  'inline-flex min-h-[44px] items-center justify-center rounded-full border border-[var(--op-border-mid)] px-5 text-sm font-semibold text-[var(--op-text-2)] disabled:opacity-50';
const inputClass =
  'w-full rounded-xl border border-[var(--op-border-mid)] bg-white px-3 py-2.5 text-sm text-[var(--op-text)] outline-none focus:border-[var(--brand-gold-deep)]';

function buildCardRow(sessionId: string, verticalSlug: string | null, score: CallScoreContent): CallScoreRow {
  // deriveCard (src/lib/feedback/card.ts) only ever reads the CallScoreContent
  // fields it's handed -- these meta fields exist purely so this satisfies
  // CallScoreRow's type; a practice session has no real transcript_id or
  // rubric_version of its own.
  return {
    ...score,
    id: sessionId,
    transcript_id: sessionId,
    rubric_version: 0,
    rep_email: '',
    vertical_slug: verticalSlug ?? '',
    called_at: new Date().toISOString(),
    scored_at: new Date().toISOString(),
  };
}

export default function PracticeRoom({ sessionId }: { sessionId: string }) {
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [loadError, setLoadError] = useState<string | null>(null);

  const [verticalSlug, setVerticalSlug] = useState<string | null>(null);
  const [turns, setTurns] = useState<PracticeTurn[]>([]);
  const [ended, setEnded] = useState(false);
  const [score, setScore] = useState<CallScoreContent | null>(null);
  const [scoreReason, setScoreReason] = useState<string | null>(null);

  const [typedText, setTypedText] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [ending, setEnding] = useState(false);

  const [muted, setMuted] = useState(false);
  const [listening, setListening] = useState(false);

  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const spokenCountRef = useRef(0);

  const speechSupported = typeof window !== 'undefined' && !!(window.SpeechRecognition ?? window.webkitSpeechRecognition);

  function speak(text: string) {
    if (muted || typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    const utterance = new SpeechSynthesisUtterance(text);
    window.speechSynthesis.speak(utterance);
  }

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/practice/${sessionId}`)
      .then(res => res.json())
      .then((json: SessionResponse) => {
        if (cancelled) return;
        if (!json.session) {
          setLoadError(json.reason ?? json.error ?? 'Practice session not found.');
          setStatus('error');
          return;
        }
        // On a fresh session this is just the opening line (spoken normally,
        // below). On a reloaded/resumed session it can be a long history --
        // only the most recent line is eligible to be spoken here, so
        // reloading mid-call doesn't blast the whole conversation through
        // TTS at once.
        spokenCountRef.current = Math.max(0, json.session.turns.length - 1);
        setVerticalSlug(json.session.verticalSlug);
        setTurns(json.session.turns);
        setEnded(json.session.status === 'ended');
        setScore(json.session.score);
        setStatus('ready');
      })
      .catch(() => {
        if (!cancelled) {
          setLoadError('Could not load the practice session.');
          setStatus('error');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  // Speak every customer turn that hasn't been spoken yet -- covers both the
  // opening line (present on first load) and every later reply, without
  // re-speaking on unrelated re-renders.
  useEffect(() => {
    for (let i = spokenCountRef.current; i < turns.length; i++) {
      if (turns[i].speaker === 'customer') speak(turns[i].text);
    }
    spokenCountRef.current = turns.length;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [turns]);

  async function sendTurn(text: string) {
    const trimmed = text.trim();
    if (!trimmed || sending || ended) return;
    setSending(true);
    setSendError(null);
    try {
      const res = await fetch(`/api/practice/${sessionId}/turn`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: trimmed }),
      });
      const json = await res.json();
      if (!json.saved || typeof json.reply !== 'string') {
        setSendError(json.error ?? json.reason ?? "Could not get the customer's reply.");
        return;
      }
      const at = new Date().toISOString();
      setTurns(prev => [...prev, { speaker: 'rep', text: trimmed, at }, { speaker: 'customer', text: json.reply, at }]);
      setTypedText('');
    } catch {
      setSendError("Could not get the customer's reply.");
    } finally {
      setSending(false);
    }
  }

  function startListening() {
    if (!speechSupported || listening || sending || ended) return;
    const Ctor = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!Ctor) return;
    const recognition = new Ctor();
    recognition.lang = 'en-US';
    recognition.interimResults = false;
    recognition.continuous = false;
    recognition.onresult = event => {
      const transcript = event.results[0]?.[0]?.transcript ?? '';
      if (transcript.trim()) sendTurn(transcript);
    };
    recognition.onerror = () => setListening(false);
    recognition.onend = () => setListening(false);
    recognitionRef.current = recognition;
    recognition.start();
    setListening(true);
  }

  function stopListening() {
    recognitionRef.current?.stop();
    setListening(false);
  }

  async function endAndScore() {
    setEnding(true);
    setSendError(null);
    try {
      const res = await fetch(`/api/practice/${sessionId}/end`, { method: 'POST' });
      const json: EndResponse = await res.json();
      if (!json.saved) {
        setSendError(json.error ?? 'Could not end the practice call.');
        return;
      }
      setEnded(true);
      setScore(json.score ?? null);
      setScoreReason(json.scored ? null : (json.reason ?? 'Could not score this practice call.'));
    } catch {
      setSendError('Could not end the practice call.');
    } finally {
      setEnding(false);
    }
  }

  if (status === 'loading') {
    return <p className="text-sm text-[var(--op-dim)]">Loading practice call…</p>;
  }
  if (status === 'error') {
    return (
      <div className="flex flex-col gap-4">
        <div className={bannerClass}>{loadError}</div>
        <Link href="/practice" className="text-sm font-semibold text-[var(--brand-gold-deep)] hover:underline">
          ← Back to practice
        </Link>
      </div>
    );
  }

  if (ended) {
    const card = score ? deriveCard(buildCardRow(sessionId, verticalSlug, score)) : null;
    const praiseOnly = score ? isPraiseOnly({ fix: score.fix }) : false;
    return (
      <div className="flex flex-col gap-5">
        <Link href="/practice" className="text-sm font-semibold text-[var(--op-dim)] hover:underline">
          ← Practice
        </Link>

        {!card && <div className={bannerClass}>{scoreReason ?? 'Could not score this practice call.'}</div>}

        {card && (
          <div className="coach-card">
            <CardWinBlock headline={card.headline} fix={card.fix} praiseOnly={praiseOnly} />
            <CardDetails detail={{ ...card.detail, guarantees: card.detail.guarantees as Guarantees }} />
          </div>
        )}

        <div>
          <h2 className="text-xs font-bold uppercase tracking-[.14em] text-[var(--op-dim)]">Transcript</h2>
          <TranscriptList turns={turns} />
        </div>

        <Link href="/practice" className={`${primaryButtonClass} w-fit`}>
          Practice again
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <Link href="/practice" className="text-sm font-semibold text-[var(--op-dim)] hover:underline">
          ← Practice
        </Link>
        <button onClick={() => setMuted(m => !m)} className="text-xs font-semibold uppercase tracking-[.1em] text-[var(--op-dim)] hover:underline">
          {muted ? 'Unmute customer voice' : 'Mute customer voice'}
        </button>
      </div>

      <TranscriptList turns={turns} />

      {sendError && <div className={bannerClass}>{sendError}</div>}

      <div className="coach-card flex flex-col gap-3">
        {speechSupported ? (
          <button
            onClick={listening ? stopListening : startListening}
            disabled={sending || ending}
            className={`${primaryButtonClass} w-fit ${listening ? 'motion-safe:animate-pulse' : ''}`}
          >
            {listening ? 'Listening… tap to stop' : 'Tap to talk'}
          </button>
        ) : (
          <p className="text-xs text-[var(--op-dim)]">Voice is not supported in this browser -- type your line instead.</p>
        )}

        <form
          onSubmit={e => {
            e.preventDefault();
            sendTurn(typedText);
          }}
          className="flex gap-2"
        >
          <input
            className={inputClass}
            placeholder="Type your line…"
            value={typedText}
            onChange={e => setTypedText(e.target.value)}
            disabled={sending || ending}
          />
          <button type="submit" disabled={sending || ending || !typedText.trim()} className={secondaryButtonClass}>
            {sending ? 'Sending…' : 'Send'}
          </button>
        </form>
      </div>

      <button onClick={endAndScore} disabled={ending || turns.length === 0} className={`${secondaryButtonClass} w-fit`}>
        {ending ? 'Scoring…' : 'End and score'}
      </button>
    </div>
  );
}

function TranscriptList({ turns }: { turns: PracticeTurn[] }) {
  return (
    <ul className="flex flex-col gap-2">
      {turns.map((turn, i) => (
        <li key={i} className={`flex ${turn.speaker === 'rep' ? 'justify-end' : 'justify-start'}`}>
          <div
            className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm ${
              turn.speaker === 'rep'
                ? 'bg-[var(--brand-evergreen)] text-[var(--brand-cream)]'
                : 'border border-[var(--op-border)] bg-white text-[var(--op-text)]'
            }`}
          >
            {turn.text}
          </div>
        </li>
      ))}
    </ul>
  );
}

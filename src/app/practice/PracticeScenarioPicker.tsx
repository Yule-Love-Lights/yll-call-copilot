'use client';

// The /practice landing screen: pick a vertical + one of the four customer
// emotional states (+ an optional objection to drill), then "Start
// practice" creates the session (POST /api/practice/start) and routes
// straight into the room. Also lists the rep's own recent practice runs
// (GET /api/practice) so a finished session's card can be reopened.

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { bannerClass } from '../coach/CardSections';
import { formatOverallGlance } from '@/lib/formatScore';

type VerticalOption = { id: string; slug: string; name: string };

type EmotionalState = 'excited' | 'busy' | 'guarded' | 'status';

const EMOTIONAL_STATES: { value: EmotionalState; label: string; description: string }[] = [
  { value: 'excited', label: 'Excited', description: 'Thrilled about the idea, wants to see the vision come to life.' },
  { value: 'busy', label: 'Busy', description: 'Slammed today, wants this handled with the least effort from them.' },
  { value: 'guarded', label: 'Guarded', description: 'Skeptical from a past bad experience, wants real proof and guarantees.' },
  { value: 'status', label: 'Status-driven', description: 'Wants to be the best-looking house on the block, matches ambition.' },
];

type RecentSession = {
  id: string;
  verticalSlug: string | null;
  emotionalState: string;
  objective: string | null;
  status: 'active' | 'ended';
  score: { overall: number } | null;
  createdAt: string;
  endedAt: string | null;
};

const selectClass =
  'w-full rounded-xl border border-[var(--op-border-mid)] bg-white px-3 py-2.5 text-sm text-[var(--op-text)] outline-none focus:border-[var(--brand-gold-deep)]';
const inputClass = selectClass;
const primaryButtonClass =
  'inline-flex min-h-[44px] items-center justify-center rounded-full bg-[var(--brand-evergreen)] px-6 text-sm font-bold text-[var(--brand-cream)] shadow-[0_2px_10px_rgba(11,20,15,0.25)] disabled:opacity-50';

export default function PracticeScenarioPicker() {
  const router = useRouter();

  const [verticals, setVerticals] = useState<VerticalOption[]>([]);
  const [verticalSlug, setVerticalSlug] = useState('');
  const [emotionalState, setEmotionalState] = useState<EmotionalState>('excited');
  const [objective, setObjective] = useState('');

  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [recent, setRecent] = useState<RecentSession[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/verticals')
      .then(res => res.json())
      .then((json: { verticals?: VerticalOption[] }) => {
        if (cancelled) return;
        const options = json.verticals ?? [];
        setVerticals(options);
        if (options.length > 0) setVerticalSlug(prev => prev || options[0].slug);
      })
      .catch(() => {});
    fetch('/api/practice')
      .then(res => res.json())
      .then((json: { sessions?: RecentSession[] }) => {
        if (!cancelled) setRecent(json.sessions ?? []);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  async function startPractice() {
    if (!verticalSlug) {
      setError('Pick a vertical first.');
      return;
    }
    setStarting(true);
    setError(null);
    try {
      const res = await fetch('/api/practice/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vertical_slug: verticalSlug,
          emotional_state: emotionalState,
          objective: objective.trim() || undefined,
        }),
      });
      const json = await res.json();
      if (!json.configured || !json.saved || !json.id) {
        setError(json.error ?? json.reason ?? 'Could not start the practice call.');
        setStarting(false);
        return;
      }
      router.push(`/practice/${json.id}`);
    } catch {
      setError('Could not start the practice call.');
      setStarting(false);
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <div className="coach-card flex flex-col gap-5">
        <div>
          <label className="text-xs font-bold uppercase tracking-[.14em] text-[var(--op-dim)]">Vertical</label>
          <select className={`mt-1.5 ${selectClass}`} value={verticalSlug} onChange={e => setVerticalSlug(e.target.value)}>
            {verticals.length === 0 && <option value="">No verticals yet</option>}
            {verticals.map(v => (
              <option key={v.id} value={v.slug}>
                {v.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="text-xs font-bold uppercase tracking-[.14em] text-[var(--op-dim)]">Customer&apos;s emotional state</label>
          <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
            {EMOTIONAL_STATES.map(state => (
              <button
                key={state.value}
                type="button"
                onClick={() => setEmotionalState(state.value)}
                className={`rounded-xl border px-3.5 py-3 text-left transition-colors ${
                  emotionalState === state.value
                    ? 'border-transparent bg-[var(--brand-evergreen)] text-[var(--brand-cream)]'
                    : 'border-[var(--op-border-mid)] bg-white text-[var(--op-text)] hover:bg-[rgba(11,20,15,0.03)]'
                }`}
              >
                <div className="text-sm font-bold">{state.label}</div>
                <div className={`mt-0.5 text-xs ${emotionalState === state.value ? 'text-[var(--brand-cream-dim)]' : 'text-[var(--op-dim)]'}`}>
                  {state.description}
                </div>
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="text-xs font-bold uppercase tracking-[.14em] text-[var(--op-dim)]">Objection to drill (optional)</label>
          <input
            className={`mt-1.5 ${inputClass}`}
            placeholder='e.g. "the price is too high" or "I need to talk to my spouse"'
            value={objective}
            onChange={e => setObjective(e.target.value)}
          />
        </div>

        {error && <div className={bannerClass}>{error}</div>}

        <button onClick={startPractice} disabled={starting} className={`${primaryButtonClass} w-fit`}>
          {starting ? 'Starting…' : 'Start practice'}
        </button>
      </div>

      {recent.length > 0 && (
        <div>
          <h2 className="text-xs font-bold uppercase tracking-[.14em] text-[var(--op-dim)]">Your recent practice runs</h2>
          <ul className="mt-2 flex flex-col gap-2">
            {recent.map(session => (
              <li key={session.id}>
                <Link
                  href={`/practice/${session.id}`}
                  className="flex items-center justify-between gap-3 rounded-xl border border-[var(--op-border)] bg-white px-4 py-3 text-sm hover:bg-[rgba(11,20,15,0.02)]"
                >
                  <span className="text-[var(--op-text-2)]">
                    {session.verticalSlug ?? 'unknown'} · {session.emotionalState}
                    {session.objective ? ` · "${session.objective}"` : ''}
                  </span>
                  <span className="text-[var(--op-dim)]">
                    {session.status === 'active'
                      ? 'in progress'
                      : session.score
                        ? `scored ${formatOverallGlance(session.score.overall)}`
                        : 'ended'}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

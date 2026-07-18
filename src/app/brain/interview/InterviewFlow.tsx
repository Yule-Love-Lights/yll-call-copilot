'use client';

// The step-through "interview yourself" flow: one curated question at a
// time (src/lib/brain/interview.ts), a progress bar, then a single submit
// that hands every answer to POST /api/brain/interview -- which runs the
// one Claude call that distills them (or degrades to raw manual-style rows
// if Claude is not configured) -- and a final "here is what your brain
// learned" summary. Answers live in component state as the operator types,
// so stepping back to an earlier question never loses what was already
// typed on a later one.

import { useState } from 'react';
import { INTERVIEW_QUESTIONS } from '@/lib/brain/interview';
import type { InsightLens, InsightSource } from '@/lib/brain/types';

type InsightSummary = { id: string; lens: InsightLens; title: string; content: string; source: InsightSource };
type SubmitResponse = { configured: boolean; saved: boolean; reason?: string; insights?: InsightSummary[] };

const LENS_LABELS: Record<InsightLens, string> = {
  market: 'Market',
  leads: 'Leads',
  coaching: 'Coaching',
  general: 'General',
};

const inputClass =
  'w-full rounded-xl border border-[var(--op-border-mid)] bg-white/90 px-3 py-2 text-sm text-[var(--op-text)] outline-none focus:border-[var(--brand-gold-deep)]';
const primaryButtonClass =
  'rounded-full bg-[var(--brand-evergreen)] px-5 py-2.5 text-sm font-bold text-[var(--brand-cream)] hover:bg-[var(--brand-evergreen-3)] disabled:opacity-50';
const secondaryButtonClass =
  'rounded-full border border-[var(--op-border-mid)] px-4 py-2 text-sm font-semibold text-[var(--op-text-2)] hover:bg-[rgba(11,20,15,0.05)] disabled:opacity-50';

export default function InterviewFlow() {
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<string[]>(() => INTERVIEW_QUESTIONS.map(() => ''));
  const [phase, setPhase] = useState<'answering' | 'submitting' | 'done' | 'error'>('answering');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<InsightSummary[]>([]);

  const question = INTERVIEW_QUESTIONS[step];
  const isLast = step === INTERVIEW_QUESTIONS.length - 1;

  function setAnswer(value: string) {
    setAnswers(prev => prev.map((a, i) => (i === step ? value : a)));
  }

  async function finish() {
    setPhase('submitting');
    setError(null);
    try {
      const payload = INTERVIEW_QUESTIONS.map((q, i) => ({ question: q.question, lens: q.lens, answer: answers[i] }));
      const res = await fetch('/api/brain/interview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json: SubmitResponse = await res.json().catch(() => ({ configured: true, saved: false }));
      if (!res.ok || !json.saved) {
        setError(json.reason ?? 'Could not save the interview. Your answers are still on screen.');
        setPhase('error');
        return;
      }
      setResult(json.insights ?? []);
      setPhase('done');
    } catch {
      setError('Could not save the interview (network). Your answers are still on screen.');
      setPhase('error');
    }
  }

  if (phase === 'done') {
    return (
      <div className="flex flex-col gap-4">
        <div className="coach-card coach-card--gold">
          <h2 className="text-[18px] font-bold text-[var(--op-text)]">Here is what your brain learned</h2>
          <p className="mt-1 text-sm text-[var(--op-dim)]">
            {result.length} note{result.length === 1 ? '' : 's'} saved. Nothing you typed was lost.
          </p>
        </div>
        {result.map(item => (
          <div key={item.id} className="coach-card">
            <span className="text-[10.5px] font-extrabold uppercase tracking-[.18em] text-[var(--brand-gold-deep)]">
              {LENS_LABELS[item.lens]}
            </span>
            <h3 className="text-[15px] font-bold text-[var(--op-text)]">{item.title}</h3>
            <p className="mt-1 text-sm text-[var(--op-dim)]">{item.content}</p>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-2">
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--op-border)]">
          <div
            className="h-full rounded-full bg-[var(--brand-gold)] transition-all"
            style={{ width: `${((step + 1) / INTERVIEW_QUESTIONS.length) * 100}%` }}
          />
        </div>
        <span className="shrink-0 text-xs font-semibold text-[var(--op-dim)]">
          {step + 1} / {INTERVIEW_QUESTIONS.length}
        </span>
      </div>

      <div className="coach-card">
        <span className="text-[10.5px] font-extrabold uppercase tracking-[.18em] text-[var(--brand-gold-deep)]">
          {LENS_LABELS[question.lens]}
        </span>
        <h2 className="text-[17px] font-bold leading-snug text-[var(--op-text)]">{question.question}</h2>
        <textarea
          value={answers[step]}
          onChange={e => setAnswer(e.target.value)}
          rows={5}
          placeholder="Answer in your own words. Skip is fine too."
          className={`${inputClass} mt-2`}
        />
      </div>

      {error && <p className="text-sm font-medium text-[var(--brand-red)]">{error}</p>}

      <div className="flex items-center justify-between">
        <button
          onClick={() => setStep(s => Math.max(0, s - 1))}
          disabled={step === 0 || phase === 'submitting'}
          className={secondaryButtonClass}
        >
          Back
        </button>
        {isLast ? (
          <button onClick={finish} disabled={phase === 'submitting'} className={primaryButtonClass}>
            {phase === 'submitting' ? 'Thinking…' : 'Finish'}
          </button>
        ) : (
          <button
            onClick={() => setStep(s => Math.min(INTERVIEW_QUESTIONS.length - 1, s + 1))}
            className={primaryButtonClass}
          >
            Next
          </button>
        )}
      </div>
    </div>
  );
}

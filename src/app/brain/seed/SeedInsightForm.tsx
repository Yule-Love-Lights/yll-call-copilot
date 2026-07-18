'use client';

// The manual half of "Seed the Brain": a short form (title, content, lens,
// optional vertical) plus a list of what has been taught so far, each
// deletable. Talks to /api/brain/insights (list/create) and
// /api/brain/insights/[id] (delete). Style matches the coach family
// (coach-card / op-* / brand-* tokens), same as FeedbackFeed.tsx.

import { useCallback, useEffect, useState } from 'react';
import type { InsightLens, InsightSource } from '@/lib/brain/types';

type Insight = {
  id: string;
  verticalId: string | null;
  source: InsightSource;
  lens: InsightLens;
  title: string;
  content: string;
  createdAt: string;
};

type ListResponse = { configured: boolean; migrated?: boolean; reason?: string; insights?: Insight[] };
type SaveResponse = { configured: boolean; saved: boolean; reason?: string; insight?: Insight };

type VerticalOption = { id: string; name: string };
type VerticalsResponse = { configured: boolean; verticals?: VerticalOption[] };

const LENS_OPTIONS: { value: InsightLens; label: string }[] = [
  { value: 'market', label: 'Market' },
  { value: 'leads', label: 'Leads' },
  { value: 'coaching', label: 'Coaching' },
  { value: 'general', label: 'General' },
];

const inputClass =
  'w-full rounded-xl border border-[var(--op-border-mid)] bg-white/90 px-3 py-2 text-sm text-[var(--op-text)] outline-none focus:border-[var(--brand-gold-deep)]';
const primaryButtonClass =
  'rounded-full bg-[var(--brand-evergreen)] px-4 py-2 text-sm font-bold text-[var(--brand-cream)] hover:bg-[var(--brand-evergreen-3)] disabled:opacity-50';
const bannerClass =
  'rounded-2xl border border-[rgba(122,94,32,0.3)] bg-[rgba(232,184,98,0.12)] px-4 py-3 text-sm font-medium text-[var(--brand-gold-deep)]';

function lensLabel(lens: InsightLens): string {
  return LENS_OPTIONS.find(o => o.value === lens)?.label ?? lens;
}

export default function SeedInsightForm() {
  const [insights, setInsights] = useState<Insight[]>([]);
  const [verticals, setVerticals] = useState<VerticalOption[]>([]);
  const [migrated, setMigrated] = useState(true);
  const [reason, setReason] = useState<string | null>(null);
  const [status, setStatus] = useState<'loading' | 'done' | 'error'>('loading');

  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [lens, setLens] = useState<InsightLens>('general');
  const [verticalId, setVerticalId] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const load = useCallback(() => {
    return fetch('/api/brain/insights')
      .then(res => res.json())
      .then((json: ListResponse) => {
        setMigrated(json.migrated !== false);
        setReason(json.reason ?? null);
        setInsights(json.insights ?? []);
        setStatus('done');
      })
      .catch(() => setStatus('error'));
  }, []);

  useEffect(() => {
    load();
    fetch('/api/verticals')
      .then(res => res.json())
      .then((json: VerticalsResponse) => setVerticals(json.verticals ?? []))
      .catch(() => {});
  }, [load]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !content.trim()) return;
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch('/api/brain/insights', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source: 'manual',
          lens,
          title: title.trim(),
          content: content.trim(),
          vertical_id: verticalId || undefined,
        }),
      });
      const json: SaveResponse = await res.json().catch(() => ({ configured: true, saved: false }));
      if (!res.ok || !json.saved) {
        // Keep the draft on screen so nothing typed is lost on a failed save.
        setSaveError(json.reason ?? 'Save failed. Your note is still on screen.');
        return;
      }
      setTitle('');
      setContent('');
      await load();
    } catch {
      setSaveError('Save failed (network). Your note is still on screen.');
    } finally {
      setSaving(false);
    }
  }

  async function onDelete(id: string) {
    setInsights(list => list.filter(i => i.id !== id));
    await fetch(`/api/brain/insights/${id}`, { method: 'DELETE' }).catch(() => {});
  }

  return (
    <div className="flex flex-col gap-6">
      {!migrated && <div className={bannerClass}>{reason ?? 'Run migration 0015 first.'}</div>}
      {migrated && reason && <div className={bannerClass}>{reason}</div>}

      <form onSubmit={onSubmit} className="coach-card flex flex-col gap-3">
        <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Title" className={inputClass} />
        <textarea
          value={content}
          onChange={e => setContent(e.target.value)}
          placeholder="What do you want the team to know?"
          rows={4}
          className={inputClass}
        />
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-[var(--op-text-2)]">
            Lens
            <select value={lens} onChange={e => setLens(e.target.value as InsightLens)} className={`${inputClass} w-auto`}>
              {LENS_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm text-[var(--op-text-2)]">
            Vertical
            <select value={verticalId} onChange={e => setVerticalId(e.target.value)} className={`${inputClass} w-auto`}>
              <option value="">Whole business</option>
              {verticals.map(v => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" disabled={saving} className={`ml-auto ${primaryButtonClass}`}>
            {saving ? 'Saving…' : 'Teach the brain'}
          </button>
        </div>
        {saveError && <p className="text-sm font-medium text-[var(--brand-red)]">{saveError}</p>}
      </form>

      <section className="flex flex-col gap-3">
        <h2 className="text-[10.5px] font-extrabold uppercase tracking-[.18em] text-[var(--op-dim)]">What the brain knows</h2>
        {status === 'loading' && <p className="text-sm text-[var(--op-dim)]">Loading…</p>}
        {status === 'error' && <p className="text-sm font-medium text-[var(--brand-red)]">Could not load insights.</p>}
        {status === 'done' && migrated && insights.length === 0 && (
          <p className="text-sm text-[var(--op-dim)]">Nothing taught yet. Add the first one above.</p>
        )}
        {insights.length > 0 && (
          <ul className="flex flex-col gap-3">
            {insights.map(i => (
              <li key={i.id} className="coach-card">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex flex-col gap-1">
                    <span className="text-[10.5px] font-extrabold uppercase tracking-[.18em] text-[var(--brand-gold-deep)]">
                      {lensLabel(i.lens)} · {i.source}
                    </span>
                    <h3 className="text-[15px] font-bold text-[var(--op-text)]">{i.title}</h3>
                  </div>
                  <button
                    onClick={() => onDelete(i.id)}
                    className="shrink-0 text-sm font-semibold text-[var(--brand-red)] hover:underline"
                  >
                    Delete
                  </button>
                </div>
                <p className="mt-1 text-sm text-[var(--op-dim)]">{i.content}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

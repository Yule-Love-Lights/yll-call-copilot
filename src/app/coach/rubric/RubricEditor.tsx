'use client';

// The rubric workspace: view the active rubric section by section, edit
// weights/instructions inline, save as a new version, and browse/restore
// version history. Mirrors src/app/verticals/[id]/VerticalDetail.tsx's
// PlaybookView/PlaybookEditor pattern.

import { useCallback, useEffect, useState } from 'react';
import type { RubricContent, RubricDim } from '@/lib/scoring/types';

type HistoryEntry = { version: number; source: 'seeded' | 'edited'; createdAt: string };

type RubricResponse = {
  configured: boolean;
  rubric?: RubricContent;
  version?: number;
  source?: 'seeded' | 'edited';
  history?: HistoryEntry[];
  reason?: string;
  error?: string;
};

const inputClass =
  'rounded-md border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900';
const primaryButtonClass =
  'rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300';
const secondaryButtonClass =
  'rounded-md border border-zinc-300 px-3 py-1 text-sm hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-900';

function sumWeights(dims: RubricDim[]): number {
  return dims.reduce((sum, d) => sum + d.weight, 0);
}

export default function RubricEditor() {
  const [data, setData] = useState<RubricResponse | null>(null);
  const [status, setStatus] = useState<'loading' | 'done' | 'error'>('loading');

  const [viewingVersion, setViewingVersion] = useState<number | null>(null);
  const [viewedRubric, setViewedRubric] = useState<RubricContent | null>(null);
  const [restoring, setRestoring] = useState(false);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<RubricContent | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const load = useCallback(() => {
    return fetch('/api/rubric')
      .then(async res => {
        const json: RubricResponse = await res.json();
        if (!res.ok || json.error) throw new Error(json.error ?? `HTTP ${res.status}`);
        return json;
      })
      .then(json => {
        setData(json);
        setViewingVersion(json.version ?? null);
        setViewedRubric(json.rubric ?? null);
        setEditing(false);
        setStatus('done');
      })
      .catch(() => setStatus('error'));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function onSelectVersion(versionStr: string) {
    const version = Number(versionStr);
    setEditing(false);
    if (data && version === data.version) {
      setViewingVersion(version);
      setViewedRubric(data.rubric ?? null);
      return;
    }
    const res = await fetch(`/api/rubric?version=${version}`);
    const json: RubricResponse = await res.json();
    if (res.ok && !json.error) {
      setViewingVersion(json.version ?? version);
      setViewedRubric(json.rubric ?? null);
    }
  }

  async function saveContent(content: RubricContent) {
    setSaveError(null);
    const res = await fetch('/api/rubric', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(content),
    });
    const json = await res.json().catch(() => ({}));
    if (res.ok && json.saved) {
      await load();
      return true;
    }
    setSaveError(json.reason ?? 'Save failed.');
    return false;
  }

  async function onRestore() {
    if (!viewedRubric) return;
    setRestoring(true);
    try {
      await saveContent(viewedRubric);
    } finally {
      setRestoring(false);
    }
  }

  function startEdit() {
    if (!viewedRubric) return;
    setDraft(viewedRubric);
    setEditing(true);
  }

  async function onSaveEdit() {
    if (!draft) return;
    setSaving(true);
    try {
      await saveContent(draft);
    } finally {
      setSaving(false);
    }
  }

  if (status === 'loading') return <p className="text-sm text-zinc-500">Loading…</p>;
  if (status === 'error' || !data) {
    return <p className="text-sm text-red-600 dark:text-red-400">Could not load the rubric.</p>;
  }
  if (data.reason) {
    return <p className="text-sm text-amber-700 dark:text-amber-300">{data.reason}</p>;
  }

  const isActiveVersion = viewingVersion === data.version;

  return (
    <div className="flex flex-col gap-8">
      {(data.history?.length ?? 0) > 0 && (
        <div className="flex flex-wrap items-center gap-3">
          <label htmlFor="version" className="text-sm text-zinc-500">
            Version
          </label>
          <select
            id="version"
            value={viewingVersion ?? ''}
            onChange={e => onSelectVersion(e.target.value)}
            className="rounded-md border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          >
            {(data.history ?? []).map(h => (
              <option key={h.version} value={h.version}>
                v{h.version} ({h.source}) {new Date(h.createdAt).toLocaleString()}
                {h.version === data.version ? ' — active' : ''}
              </option>
            ))}
          </select>
          {!isActiveVersion && (
            <button onClick={onRestore} disabled={restoring} className={secondaryButtonClass}>
              {restoring ? 'Restoring…' : 'Restore this version'}
            </button>
          )}
        </div>
      )}
      {saveError && <p className="text-sm text-red-600 dark:text-red-400">{saveError}</p>}

      {!viewedRubric ? (
        <p className="text-sm text-zinc-500">No rubric found.</p>
      ) : editing && draft ? (
        <RubricForm draft={draft} onChange={setDraft} onSave={onSaveEdit} onCancel={() => setEditing(false)} saving={saving} />
      ) : (
        <RubricView rubric={viewedRubric} onEdit={isActiveVersion ? startEdit : undefined} />
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-zinc-200 dark:border-zinc-800">
      <h3 className="border-b border-zinc-200 px-4 py-2 text-sm font-semibold dark:border-zinc-800">{title}</h3>
      <div className="px-4 py-3">{children}</div>
    </div>
  );
}

function RubricView({ rubric, onEdit }: { rubric: RubricContent; onEdit?: () => void }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Rubric</h2>
        {onEdit && (
          <button onClick={onEdit} className="text-sm text-blue-600 hover:underline dark:text-blue-400">
            Edit
          </button>
        )}
      </div>

      <Section title="Master dimension — emotional read and match">
        <p className="text-sm">{rubric.master}</p>
      </Section>

      <Section title={`Sales (weights sum to ${sumWeights(rubric.sales)})`}>
        <div className="flex flex-col gap-3">
          {rubric.sales.map(d => (
            <div key={d.key}>
              <p className="text-sm font-medium">
                {d.name} <span className="text-zinc-500">({d.weight})</span>
              </p>
              <p className="text-sm text-zinc-600 dark:text-zinc-400">{d.instructions}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section title={`Hospitality (weights sum to ${sumWeights(rubric.hospitality)})`}>
        <div className="flex flex-col gap-3">
          {rubric.hospitality.map(d => (
            <div key={d.key}>
              <p className="text-sm font-medium">
                {d.name} <span className="text-zinc-500">({d.weight})</span>
              </p>
              <p className="text-sm text-zinc-600 dark:text-zinc-400">{d.instructions}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Experience — the 10/10 north star">
        <p className="text-sm">{rubric.experience.instructions}</p>
      </Section>

      <Section title="Guarantees note">
        <p className="text-sm">{rubric.guarantees_note}</p>
      </Section>

      <Section
        title={`Overall weighting (sums to ${(
          rubric.weighting.experience +
          rubric.weighting.sales +
          rubric.weighting.hospitality
        ).toFixed(2)})`}
      >
        <p className="text-sm">
          Experience {rubric.weighting.experience} · Sales {rubric.weighting.sales} · Hospitality{' '}
          {rubric.weighting.hospitality}
        </p>
      </Section>
    </div>
  );
}

function DimEditor({ dims, onChange }: { dims: RubricDim[]; onChange: (dims: RubricDim[]) => void }) {
  return (
    <div className="flex flex-col gap-3">
      {dims.map((d, i) => (
        <div key={d.key} className="flex flex-col gap-2 rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
          <div className="flex items-center gap-2">
            <span className="min-w-32 text-sm font-medium">{d.name}</span>
            <input
              type="number"
              value={d.weight}
              onChange={e => {
                const next = [...dims];
                next[i] = { ...next[i], weight: Number(e.target.value) };
                onChange(next);
              }}
              className={`w-20 ${inputClass}`}
            />
          </div>
          <textarea
            value={d.instructions}
            onChange={e => {
              const next = [...dims];
              next[i] = { ...next[i], instructions: e.target.value };
              onChange(next);
            }}
            rows={2}
            className={`w-full ${inputClass}`}
          />
        </div>
      ))}
    </div>
  );
}

function RubricForm({
  draft,
  onChange,
  onSave,
  onCancel,
  saving,
}: {
  draft: RubricContent;
  onChange: (r: RubricContent) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Editing rubric</h2>
        <div className="flex gap-3">
          <button onClick={onCancel} className="text-sm text-zinc-500 hover:underline">
            Cancel
          </button>
          <button onClick={onSave} disabled={saving} className={primaryButtonClass}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      <Section title="Master dimension — emotional read and match">
        <textarea
          value={draft.master}
          onChange={e => onChange({ ...draft, master: e.target.value })}
          rows={4}
          className={`w-full ${inputClass}`}
        />
      </Section>

      <Section title={`Sales (weights sum to ${sumWeights(draft.sales)} — must total 100)`}>
        <DimEditor dims={draft.sales} onChange={sales => onChange({ ...draft, sales })} />
      </Section>

      <Section title={`Hospitality (weights sum to ${sumWeights(draft.hospitality)} — must total 100)`}>
        <DimEditor dims={draft.hospitality} onChange={hospitality => onChange({ ...draft, hospitality })} />
      </Section>

      <Section title="Experience — the 10/10 north star">
        <textarea
          value={draft.experience.instructions}
          onChange={e => onChange({ ...draft, experience: { instructions: e.target.value } })}
          rows={3}
          className={`w-full ${inputClass}`}
        />
      </Section>

      <Section title="Guarantees note">
        <textarea
          value={draft.guarantees_note}
          onChange={e => onChange({ ...draft, guarantees_note: e.target.value })}
          rows={3}
          className={`w-full ${inputClass}`}
        />
      </Section>

      <Section
        title={`Overall weighting (sums to ${(
          draft.weighting.experience +
          draft.weighting.sales +
          draft.weighting.hospitality
        ).toFixed(2)} — must total 1.0)`}
      >
        <div className="flex flex-wrap items-center gap-4">
          {(['experience', 'sales', 'hospitality'] as const).map(key => (
            <label key={key} className="flex items-center gap-2 text-sm">
              {key}
              <input
                type="number"
                step="0.01"
                value={draft.weighting[key]}
                onChange={e =>
                  onChange({ ...draft, weighting: { ...draft.weighting, [key]: Number(e.target.value) } })
                }
                className={`w-24 ${inputClass}`}
              />
            </label>
          ))}
        </div>
      </Section>
    </div>
  );
}

'use client';

// The vertical workspace: description/knowledge-notes editor, a "Generate
// playbook" action, the playbook itself rendered section by section
// (inline-editable), and a version history dropdown with restore.

import { useCallback, useEffect, useState } from 'react';
import type { Playbook } from '@/lib/playbook/types';

type HistoryEntry = { version: number; source: 'generated' | 'edited'; createdAt: string };

type VerticalData = {
  id: string;
  slug: string;
  name: string;
  description: string;
  knowledgeNotes: string;
  seasonWindow: string | null;
  activeVersion: number;
  createdAt: string;
};

type DetailResponse = {
  configured: boolean;
  claudeConfigured: boolean;
  vertical: VerticalData;
  playbook: Playbook | null;
  version: number | null;
  source: 'generated' | 'edited' | null;
  history: HistoryEntry[];
  error?: string;
};

const inputClass =
  'rounded-md border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900';
const primaryButtonClass =
  'rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300';
const secondaryButtonClass =
  'rounded-md border border-zinc-300 px-3 py-1 text-sm hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-900';

function linesToText(items: string[]): string {
  return items.join('\n');
}
function textToLines(text: string): string[] {
  return text
    .split('\n')
    .map(s => s.trim())
    .filter(Boolean);
}

export default function VerticalDetail({ id }: { id: string }) {
  const [data, setData] = useState<DetailResponse | null>(null);
  const [status, setStatus] = useState<'loading' | 'done' | 'error'>('loading');

  const [description, setDescription] = useState('');
  const [knowledgeNotes, setKnowledgeNotes] = useState('');
  const [savingMeta, setSavingMeta] = useState(false);
  const [metaError, setMetaError] = useState<string | null>(null);

  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);

  const [viewingVersion, setViewingVersion] = useState<number | null>(null);
  const [viewedPlaybook, setViewedPlaybook] = useState<Playbook | null>(null);
  const [restoring, setRestoring] = useState(false);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Playbook | null>(null);
  const [saving, setSaving] = useState(false);

  // Not an async function called directly from useEffect — every setState
  // call lives inside a .then()/.catch() callback so React doesn't see a
  // synchronous state update in the effect body (react-hooks/set-state-in-effect).
  const load = useCallback(() => {
    return fetch(`/api/verticals/${id}`)
      .then(async res => {
        const json: DetailResponse = await res.json();
        if (!res.ok || json.error) throw new Error(json.error ?? `HTTP ${res.status}`);
        return json;
      })
      .then(json => {
        setData(json);
        setDescription(json.vertical.description);
        setKnowledgeNotes(json.vertical.knowledgeNotes);
        setViewingVersion(json.version);
        setViewedPlaybook(json.playbook);
        setEditing(false);
        setStatus('done');
      })
      .catch(() => setStatus('error'));
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  async function onSaveMeta() {
    setSavingMeta(true);
    setMetaError(null);
    try {
      const res = await fetch(`/api/verticals/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description, knowledgeNotes }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json || json.error) {
        // Do NOT reload on failure — load() always overwrites these two
        // textareas with whatever the server currently holds, which would
        // silently replace the rep's just-typed edits with the stale
        // pre-edit text.
        setMetaError(json?.error ?? 'Could not save.');
        return;
      }
      await load();
    } catch {
      setMetaError('Could not save.');
    } finally {
      setSavingMeta(false);
    }
  }

  async function onGenerate() {
    setGenerating(true);
    setGenerateError(null);
    try {
      const res = await fetch(`/api/verticals/${id}/generate`, { method: 'POST' });
      const json = await res.json();
      if (!res.ok || !json.generated) {
        setGenerateError(json.reason ?? 'Generation failed.');
        return;
      }
      await load();
    } finally {
      setGenerating(false);
    }
  }

  async function onSelectVersion(versionStr: string) {
    const version = Number(versionStr);
    setEditing(false);
    if (data && version === data.version) {
      setViewingVersion(version);
      setViewedPlaybook(data.playbook);
      return;
    }
    const res = await fetch(`/api/verticals/${id}?version=${version}`);
    const json: DetailResponse = await res.json();
    if (res.ok && !json.error) {
      setViewingVersion(json.version);
      setViewedPlaybook(json.playbook);
    }
  }

  async function onRestore() {
    if (!viewedPlaybook) return;
    setRestoring(true);
    try {
      await fetch(`/api/verticals/${id}/playbook`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(viewedPlaybook),
      });
      await load();
    } finally {
      setRestoring(false);
    }
  }

  function startEdit() {
    if (!viewedPlaybook) return;
    setDraft(viewedPlaybook);
    setEditing(true);
  }

  async function onSaveEdit() {
    if (!draft) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/verticals/${id}/playbook`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
      });
      const json = await res.json();
      if (res.ok && json.saved) {
        await load();
      }
    } finally {
      setSaving(false);
    }
  }

  if (status === 'loading') return <p className="text-sm text-zinc-500">Loading…</p>;
  if (status === 'error' || !data) {
    return <p className="text-sm text-red-600 dark:text-red-400">Could not load vertical.</p>;
  }

  const isActiveVersion = viewingVersion === data.vertical.activeVersion;

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-semibold">{data.vertical.name}</h1>
        <p className="mt-1 text-sm text-zinc-500">{data.vertical.slug}</p>
      </div>

      <section className="flex flex-col gap-3">
        <label className="text-sm font-semibold" htmlFor="description">
          Description
        </label>
        <textarea
          id="description"
          value={description}
          onChange={e => setDescription(e.target.value)}
          rows={3}
          className={inputClass}
        />
        <label className="text-sm font-semibold" htmlFor="knowledgeNotes">
          Knowledge notes
        </label>
        <textarea
          id="knowledgeNotes"
          value={knowledgeNotes}
          onChange={e => setKnowledgeNotes(e.target.value)}
          rows={4}
          placeholder="Pricing, service area, past-customer patterns — anything the playbook should know."
          className={inputClass}
        />
        <button onClick={onSaveMeta} disabled={savingMeta} className={`self-start ${primaryButtonClass}`}>
          {savingMeta ? 'Saving…' : 'Save'}
        </button>
        {metaError && <p className="text-sm text-red-600 dark:text-red-400">{metaError}</p>}
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={onGenerate}
            disabled={generating || !data.claudeConfigured}
            className={primaryButtonClass}
          >
            {generating ? 'Generating…' : 'Generate playbook'}
          </button>
          {!data.claudeConfigured && (
            <span className="text-sm text-zinc-500">
              Claude not configured — set ANTHROPIC_API_KEY in .env.local.
            </span>
          )}
        </div>
        {generateError && <p className="text-sm text-red-600 dark:text-red-400">{generateError}</p>}

        {data.history.length > 0 && (
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
              {data.history.map(h => (
                <option key={h.version} value={h.version}>
                  v{h.version} ({h.source}) {new Date(h.createdAt).toLocaleString()}
                  {h.version === data.vertical.activeVersion ? ' — active' : ''}
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
      </section>

      {!viewedPlaybook ? (
        <p className="text-sm text-zinc-500">No playbook yet. Generate one above.</p>
      ) : editing && draft ? (
        <PlaybookEditor
          draft={draft}
          onChange={setDraft}
          onSave={onSaveEdit}
          onCancel={() => setEditing(false)}
          saving={saving}
        />
      ) : (
        <PlaybookView playbook={viewedPlaybook} onEdit={isActiveVersion ? startEdit : undefined} />
      )}
    </div>
  );
}

function PlaybookSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-zinc-200 dark:border-zinc-800">
      <h3 className="border-b border-zinc-200 px-4 py-2 text-sm font-semibold dark:border-zinc-800">
        {title}
      </h3>
      <div className="px-4 py-3">{children}</div>
    </div>
  );
}

function PlaybookView({ playbook, onEdit }: { playbook: Playbook; onEdit?: () => void }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Playbook</h2>
        {onEdit && (
          <button onClick={onEdit} className="text-sm text-blue-600 hover:underline dark:text-blue-400">
            Edit
          </button>
        )}
      </div>

      <PlaybookSection title="ICP">
        <p className="text-sm">{playbook.icp}</p>
      </PlaybookSection>

      <PlaybookSection title="Angles">
        <ul className="list-disc pl-5 text-sm">
          {playbook.angles.map((a, i) => (
            <li key={i}>{a}</li>
          ))}
        </ul>
      </PlaybookSection>

      <PlaybookSection title="Openers">
        <div className="flex flex-col gap-3">
          {playbook.openers.map((o, i) => (
            <div key={i}>
              <p className="text-sm font-medium">{o.label}</p>
              <p className="text-sm text-zinc-600 dark:text-zinc-400">{o.script}</p>
            </div>
          ))}
        </div>
      </PlaybookSection>

      <PlaybookSection title="Objections">
        <div className="flex flex-col gap-3">
          {playbook.objections.map((o, i) => (
            <div key={i}>
              <p className="text-sm font-medium">{o.objection}</p>
              <p className="text-sm text-zinc-600 dark:text-zinc-400">{o.response}</p>
            </div>
          ))}
        </div>
      </PlaybookSection>

      <PlaybookSection title="Avoid">
        <ul className="list-disc pl-5 text-sm">
          {playbook.avoid.map((a, i) => (
            <li key={i}>{a}</li>
          ))}
        </ul>
      </PlaybookSection>

      <PlaybookSection title="Voicemail">
        <p className="text-sm">{playbook.voicemail}</p>
      </PlaybookSection>
    </div>
  );
}

function PlaybookEditor({
  draft,
  onChange,
  onSave,
  onCancel,
  saving,
}: {
  draft: Playbook;
  onChange: (p: Playbook) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Editing playbook</h2>
        <div className="flex gap-3">
          <button onClick={onCancel} className="text-sm text-zinc-500 hover:underline">
            Cancel
          </button>
          <button onClick={onSave} disabled={saving} className={primaryButtonClass}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      <PlaybookSection title="ICP">
        <textarea
          value={draft.icp}
          onChange={e => onChange({ ...draft, icp: e.target.value })}
          rows={3}
          className={`w-full ${inputClass}`}
        />
      </PlaybookSection>

      <PlaybookSection title="Angles (one per line)">
        <textarea
          value={linesToText(draft.angles)}
          onChange={e => onChange({ ...draft, angles: textToLines(e.target.value) })}
          rows={4}
          className={`w-full ${inputClass}`}
        />
      </PlaybookSection>

      <PlaybookSection title="Openers">
        <div className="flex flex-col gap-3">
          {draft.openers.map((o, i) => (
            <div key={i} className="flex flex-col gap-2 rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
              <input
                value={o.label}
                onChange={e => {
                  const openers = [...draft.openers];
                  openers[i] = { ...openers[i], label: e.target.value };
                  onChange({ ...draft, openers });
                }}
                placeholder="Label"
                className={inputClass}
              />
              <textarea
                value={o.script}
                onChange={e => {
                  const openers = [...draft.openers];
                  openers[i] = { ...openers[i], script: e.target.value };
                  onChange({ ...draft, openers });
                }}
                rows={2}
                placeholder="Script"
                className={inputClass}
              />
              <button
                onClick={() => onChange({ ...draft, openers: draft.openers.filter((_, j) => j !== i) })}
                className="self-start text-sm text-red-600 hover:underline dark:text-red-400"
              >
                Remove
              </button>
            </div>
          ))}
          <button
            onClick={() => onChange({ ...draft, openers: [...draft.openers, { label: '', script: '' }] })}
            className="self-start text-sm text-blue-600 hover:underline dark:text-blue-400"
          >
            + Add opener
          </button>
        </div>
      </PlaybookSection>

      <PlaybookSection title="Objections">
        <div className="flex flex-col gap-3">
          {draft.objections.map((o, i) => (
            <div key={i} className="flex flex-col gap-2 rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
              <input
                value={o.objection}
                onChange={e => {
                  const objections = [...draft.objections];
                  objections[i] = { ...objections[i], objection: e.target.value };
                  onChange({ ...draft, objections });
                }}
                placeholder="Objection"
                className={inputClass}
              />
              <textarea
                value={o.response}
                onChange={e => {
                  const objections = [...draft.objections];
                  objections[i] = { ...objections[i], response: e.target.value };
                  onChange({ ...draft, objections });
                }}
                rows={2}
                placeholder="Response"
                className={inputClass}
              />
              <button
                onClick={() => onChange({ ...draft, objections: draft.objections.filter((_, j) => j !== i) })}
                className="self-start text-sm text-red-600 hover:underline dark:text-red-400"
              >
                Remove
              </button>
            </div>
          ))}
          <button
            onClick={() =>
              onChange({ ...draft, objections: [...draft.objections, { objection: '', response: '' }] })
            }
            className="self-start text-sm text-blue-600 hover:underline dark:text-blue-400"
          >
            + Add objection
          </button>
        </div>
      </PlaybookSection>

      <PlaybookSection title="Avoid (one per line)">
        <textarea
          value={linesToText(draft.avoid)}
          onChange={e => onChange({ ...draft, avoid: textToLines(e.target.value) })}
          rows={3}
          className={`w-full ${inputClass}`}
        />
      </PlaybookSection>

      <PlaybookSection title="Voicemail">
        <textarea
          value={draft.voicemail}
          onChange={e => onChange({ ...draft, voicemail: e.target.value })}
          rows={3}
          className={`w-full ${inputClass}`}
        />
      </PlaybookSection>
    </div>
  );
}

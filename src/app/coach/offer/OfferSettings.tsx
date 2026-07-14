'use client';

// The offer editor: each element as an editable card (name, customer line,
// grade hint, applies-to, situational/active toggles), an add-element
// button, a financing-note text block, and a version history with rollback
// buttons. Saving always publishes a brand new version, same convention as
// the playbook editor (VerticalDetail.tsx): history is never rewritten.

import { useCallback, useEffect, useState } from 'react';
import { slugify } from '@/lib/playbook/slug';
import type { OfferContent, OfferElement } from '@/lib/offer/store';

type HistoryEntry = { version: number; source: 'seeded' | 'edited'; createdAt: string };

type OfferResponse = {
  configured: boolean;
  migrated?: boolean;
  reason?: string;
  content: OfferContent;
  version: number | null;
  source: 'seeded' | 'edited' | null;
  history: HistoryEntry[];
  error?: string;
};

const inputClass =
  'w-full rounded-md border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900';
const primaryButtonClass =
  'rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300';
const secondaryButtonClass =
  'rounded-md border border-zinc-300 px-3 py-1 text-sm hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-900';

// The common single-vertical values, matching DEFAULT_VERTICALS' slugs
// (src/lib/playbook/seed.ts). applies_to also accepts a comma-list of these
// (e.g. "holiday,event") so it stays a plain select seeded with the usual
// options rather than a hard enum. The current value is always included
// even if it doesn't match one of these, so nothing is ever lost.
const APPLIES_TO_OPTIONS = ['all', 'holiday', 'permanent', 'event', 'commercial'];

function appliesToOptions(current: string): string[] {
  return [...new Set([...APPLIES_TO_OPTIONS, current])];
}

export default function OfferSettings() {
  const [data, setData] = useState<OfferResponse | null>(null);
  const [status, setStatus] = useState<'loading' | 'done' | 'error'>('loading');
  const [draft, setDraft] = useState<OfferContent | null>(null);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [newElementName, setNewElementName] = useState('');

  const [rollingBack, setRollingBack] = useState<number | null>(null);
  const [rollbackError, setRollbackError] = useState<string | null>(null);

  const load = useCallback(() => {
    return fetch('/api/offer')
      .then(async res => {
        const json: OfferResponse = await res.json();
        if (!res.ok || json.error) throw new Error(json.error ?? `HTTP ${res.status}`);
        return json;
      })
      .then(json => {
        setData(json);
        setDraft(json.content);
        setStatus('done');
      })
      .catch(() => setStatus('error'));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function updateElement(index: number, patch: Partial<OfferElement>) {
    setDraft(current => {
      if (!current) return current;
      const elements = [...current.elements];
      elements[index] = { ...elements[index], ...patch };
      return { ...current, elements };
    });
  }

  function removeElement(index: number) {
    setDraft(current => (current ? { ...current, elements: current.elements.filter((_, i) => i !== index) } : current));
  }

  function addElement() {
    const name = newElementName.trim();
    if (!draft || !name) return;

    const baseKey = slugify(name);
    const existingKeys = new Set(draft.elements.map(el => el.key));
    let key = baseKey;
    let suffix = 2;
    while (existingKeys.has(key)) {
      key = `${baseKey}-${suffix}`;
      suffix++;
    }

    const newElement: OfferElement = {
      key,
      name,
      customer_line: '',
      grade_hint: '',
      applies_to: 'all',
      situational: false,
      active: true,
    };
    setDraft({ ...draft, elements: [...draft.elements, newElement] });
    setNewElementName('');
  }

  async function onSave() {
    if (!draft) return;
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch('/api/offer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok && json.saved) {
        await load();
      } else {
        // Keep the draft on screen so nothing typed is lost on a failed save.
        setSaveError(json.reason ?? 'Save failed. Your edits are still on screen.');
      }
    } catch {
      setSaveError('Save failed (network). Your edits are still on screen.');
    } finally {
      setSaving(false);
    }
  }

  async function onRollback(version: number) {
    setRollingBack(version);
    setRollbackError(null);
    try {
      const res = await fetch('/api/offer/rollback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ version }),
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok && json.saved) {
        await load();
      } else {
        setRollbackError(json.reason ?? 'Rollback failed.');
      }
    } catch {
      setRollbackError('Rollback failed (network).');
    } finally {
      setRollingBack(null);
    }
  }

  if (status === 'loading') return <p className="text-sm text-zinc-500">Loading…</p>;
  if (status === 'error' || !data || !draft) {
    return <p className="text-sm text-red-600 dark:text-red-400">Could not load the offer.</p>;
  }

  return (
    <div className="flex flex-col gap-8">
      {data.migrated === false && (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
          {data.reason ?? 'Run migration 0014 first.'}
        </div>
      )}

      <section className="flex flex-col gap-4">
        <h2 className="text-sm font-semibold">Elements</h2>

        {draft.elements.map((el, i) => (
          <div key={el.key} className="flex flex-col gap-2 rounded-md border border-zinc-200 p-4 dark:border-zinc-800">
            <div className="flex items-center justify-between gap-3">
              <input
                value={el.name}
                onChange={e => updateElement(i, { name: e.target.value })}
                placeholder="Name"
                className={`${inputClass} font-medium`}
              />
              <span className="shrink-0 text-xs text-zinc-400">{el.key}</span>
            </div>

            <label className="text-xs font-semibold text-zinc-500">Customer line</label>
            <textarea
              value={el.customer_line}
              onChange={e => updateElement(i, { customer_line: e.target.value })}
              rows={2}
              className={inputClass}
            />

            <label className="text-xs font-semibold text-zinc-500">Grade hint</label>
            <textarea
              value={el.grade_hint}
              onChange={e => updateElement(i, { grade_hint: e.target.value })}
              rows={2}
              className={inputClass}
            />

            <div className="flex flex-wrap items-center gap-4 pt-1">
              <label className="flex items-center gap-2 text-sm">
                Applies to
                <select
                  value={el.applies_to}
                  onChange={e => updateElement(i, { applies_to: e.target.value })}
                  className="rounded-md border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
                >
                  {appliesToOptions(el.applies_to).map(opt => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
              </label>

              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={el.situational}
                  onChange={e => updateElement(i, { situational: e.target.checked })}
                />
                Situational
              </label>

              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={el.active} onChange={e => updateElement(i, { active: e.target.checked })} />
                Active
              </label>

              <button
                onClick={() => removeElement(i)}
                className="ml-auto text-sm text-red-600 hover:underline dark:text-red-400"
              >
                Remove
              </button>
            </div>
          </div>
        ))}

        <div className="flex items-center gap-3">
          <input
            value={newElementName}
            onChange={e => setNewElementName(e.target.value)}
            placeholder="New element name"
            className={inputClass}
          />
          <button onClick={addElement} className={`shrink-0 ${secondaryButtonClass}`}>
            + Add element
          </button>
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <label className="text-sm font-semibold" htmlFor="financingNote">
          Financing note
        </label>
        <textarea
          id="financingNote"
          value={draft.financing_note}
          onChange={e => setDraft({ ...draft, financing_note: e.target.value })}
          rows={3}
          className={inputClass}
        />
      </section>

      <section className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <button onClick={onSave} disabled={saving} className={primaryButtonClass}>
            {saving ? 'Saving…' : 'Save'}
          </button>
          {data.version != null && (
            <span className="text-sm text-zinc-500">
              Active: v{data.version} ({data.source})
            </span>
          )}
        </div>
        {saveError && <p className="text-sm text-red-600 dark:text-red-400">{saveError}</p>}
      </section>

      {data.history.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold">Version history</h2>
          <ul className="divide-y divide-zinc-200 text-sm dark:divide-zinc-800">
            {data.history.map(h => (
              <li key={h.version} className="flex items-center justify-between py-2">
                <span>
                  v{h.version} ({h.source}) {new Date(h.createdAt).toLocaleString()}
                  {h.version === data.version ? ' (active)' : ''}
                </span>
                {h.version !== data.version && (
                  <button
                    onClick={() => onRollback(h.version)}
                    disabled={rollingBack === h.version}
                    className={secondaryButtonClass}
                  >
                    {rollingBack === h.version ? 'Rolling back…' : 'Roll back'}
                  </button>
                )}
              </li>
            ))}
          </ul>
          {rollbackError && <p className="text-sm text-red-600 dark:text-red-400">{rollbackError}</p>}
        </section>
      )}
    </div>
  );
}

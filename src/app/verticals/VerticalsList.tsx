'use client';

// List of verticals + "Seed YLL defaults" (only shown when the list is
// empty) + a create form. Talks to /api/verticals and /api/verticals/seed.

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

type VerticalSummary = {
  id: string;
  slug: string;
  name: string;
  description: string;
  activeVersion: number;
  updatedAt: string;
};

type ListResponse = { configured: boolean; verticals: VerticalSummary[]; error?: string };

const inputClass =
  'rounded-md border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900';
const buttonClass =
  'self-start rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300';

export default function VerticalsList() {
  const [verticals, setVerticals] = useState<VerticalSummary[]>([]);
  const [status, setStatus] = useState<'loading' | 'done' | 'error'>('loading');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [creating, setCreating] = useState(false);
  const [seeding, setSeeding] = useState(false);

  // Not an async function called directly from useEffect — every setState
  // call lives inside a .then()/.catch() callback so React doesn't see a
  // synchronous state update in the effect body (react-hooks/set-state-in-effect).
  const load = useCallback(() => {
    return fetch('/api/verticals')
      .then(async res => {
        const json: ListResponse = await res.json();
        if (!res.ok || json.error) throw new Error(json.error ?? `HTTP ${res.status}`);
        return json;
      })
      .then(json => {
        setVerticals(json.verticals);
        setStatus('done');
      })
      .catch(() => setStatus('error'));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function onSeed() {
    setSeeding(true);
    try {
      await fetch('/api/verticals/seed', { method: 'POST' });
      await load();
    } finally {
      setSeeding(false);
    }
  }

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setCreating(true);
    try {
      const res = await fetch('/api/verticals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description }),
      });
      const json = await res.json();
      if (res.ok && !json.error) {
        setName('');
        setDescription('');
        await load();
      }
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="flex flex-col gap-8">
      {status === 'done' && verticals.length === 0 && (
        <button onClick={onSeed} disabled={seeding} className={buttonClass}>
          {seeding ? 'Seeding…' : 'Seed YLL defaults'}
        </button>
      )}

      {status === 'loading' && <p className="text-sm text-zinc-500">Loading…</p>}
      {status === 'error' && (
        <p className="text-sm text-red-600 dark:text-red-400">Could not load verticals.</p>
      )}

      {verticals.length > 0 && (
        <ul className="divide-y divide-zinc-200 rounded-md border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
          {verticals.map(v => (
            <li key={v.id}>
              <Link
                href={`/verticals/${v.id}`}
                className="flex flex-col gap-0.5 px-4 py-3 hover:bg-zinc-50 dark:hover:bg-zinc-900"
              >
                <span className="text-sm font-medium">{v.name}</span>
                <span className="text-sm text-zinc-500">
                  {v.slug} · v{v.activeVersion} · updated {new Date(v.updatedAt).toLocaleDateString()}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <form
        onSubmit={onCreate}
        className="flex flex-col gap-3 rounded-md border border-zinc-200 p-4 dark:border-zinc-800"
      >
        <h2 className="text-sm font-semibold">New vertical</h2>
        <input
          type="text"
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="Name"
          className={inputClass}
        />
        <textarea
          value={description}
          onChange={e => setDescription(e.target.value)}
          placeholder="One-paragraph description of this line of business"
          rows={3}
          className={inputClass}
        />
        <button type="submit" disabled={creating || !name.trim()} className={buttonClass}>
          {creating ? 'Creating…' : 'Create vertical'}
        </button>
      </form>
    </div>
  );
}

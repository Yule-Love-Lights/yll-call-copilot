'use client';

// Search box + results list for /contacts. Submits to the server-side GHL
// proxy route; the browser never sees the API key.

import { useState } from 'react';
import type { CrmContact } from '@/lib/ghl/types';

type SearchResponse = {
  configured: boolean;
  contacts: CrmContact[];
  error?: string;
};

export default function ContactSearch() {
  const [query, setQuery] = useState('');
  const [contacts, setContacts] = useState<CrmContact[]>([]);
  const [status, setStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;
    setStatus('loading');
    try {
      const res = await fetch(`/api/ghl/contacts/search?q=${encodeURIComponent(query)}`);
      const json: SearchResponse = await res.json();
      if (!res.ok || json.error) throw new Error(json.error ?? `HTTP ${res.status}`);
      setContacts(json.contacts);
      setStatus('done');
    } catch {
      setContacts([]);
      setStatus('error');
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <form onSubmit={onSubmit} className="flex gap-2">
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Name, email, or phone"
          className="flex-1 rounded-md border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900"
        />
        <button
          type="submit"
          disabled={status === 'loading'}
          className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          {status === 'loading' ? 'Searching…' : 'Search'}
        </button>
      </form>

      {status === 'error' && (
        <p className="text-sm text-red-600 dark:text-red-400">
          Search failed. Check the server log for details.
        </p>
      )}

      {status === 'done' && contacts.length === 0 && (
        <p className="text-sm text-zinc-500">No matches.</p>
      )}

      {contacts.length > 0 && (
        <ul className="divide-y divide-zinc-200 rounded-md border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
          {contacts.map(c => (
            <li key={c.id} className="flex flex-col gap-0.5 px-4 py-3">
              <span className="text-sm font-medium">{c.fullName ?? '(no name)'}</span>
              <span className="text-sm text-zinc-500">
                {[c.email, c.phone].filter(Boolean).join(' · ') || 'no email or phone'}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

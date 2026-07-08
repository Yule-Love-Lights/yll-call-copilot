'use client';

// "Knowledge documents" section on /verticals/[id]: upload a .md/.txt/.pdf
// file as per-vertical grounding knowledge (generate.ts reads these
// alongside the knowledge notes), list what's uploaded, and delete. Talks
// to /api/verticals/[id]/documents and /api/documents/[id].

import { useCallback, useEffect, useRef, useState } from 'react';

type DocumentSummary = {
  id: string;
  title: string;
  kind: 'upload' | 'note';
  contentPreview: string;
  createdAt: string;
};

type ListResponse = {
  configured: boolean;
  migrated?: boolean;
  documents?: DocumentSummary[];
  reason?: string;
};

const inputClass =
  'rounded-md border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900';
const primaryButtonClass =
  'rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300';
const amberBannerClass =
  'rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200';

export default function KnowledgeDocuments({ verticalId }: { verticalId: string }) {
  const [documents, setDocuments] = useState<DocumentSummary[]>([]);
  const [status, setStatus] = useState<'loading' | 'done' | 'error'>('loading');
  const [migrated, setMigrated] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    return fetch(`/api/verticals/${verticalId}/documents`)
      .then(res => res.json())
      .then((json: ListResponse) => {
        setMigrated(json.migrated !== false);
        setDocuments(json.documents ?? []);
        setStatus('done');
      })
      .catch(() => setStatus('error'));
  }, [verticalId]);

  useEffect(() => {
    load();
  }, [load]);

  async function onUpload(e: React.FormEvent) {
    e.preventDefault();
    const file = fileInputRef.current?.files?.[0];
    if (!file) return;
    setUploading(true);
    setUploadError(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch(`/api/verticals/${verticalId}/documents`, { method: 'POST', body: formData });
      const json = await res.json();
      if (!res.ok || !json.saved) {
        setUploadError(json.reason ?? 'Upload failed.');
        return;
      }
      if (fileInputRef.current) fileInputRef.current.value = '';
      await load();
    } finally {
      setUploading(false);
    }
  }

  async function onDelete(id: string) {
    setDocuments(docs => docs.filter(d => d.id !== id));
    await fetch(`/api/documents/${id}`, { method: 'DELETE' });
    await load();
  }

  return (
    <section className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold">Knowledge documents</h2>
        <p className="mt-1 text-sm text-zinc-500">
          Upload reference material for this vertical. Playbook generation reads these alongside the knowledge
          notes above.
        </p>
      </div>

      {!migrated && (
        <div className={amberBannerClass}>Run migration 0003 first — knowledge documents are not set up yet.</div>
      )}

      {status === 'loading' && <p className="text-sm text-zinc-500">Loading…</p>}
      {status === 'error' && <p className="text-sm text-red-600 dark:text-red-400">Could not load documents.</p>}

      {documents.length > 0 && (
        <ul className="divide-y divide-zinc-200 rounded-md border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
          {documents.map(d => (
            <li key={d.id} className="flex items-start justify-between gap-3 px-4 py-3">
              <div className="flex flex-col gap-0.5">
                <span className="text-sm font-medium">{d.title}</span>
                <span className="text-sm text-zinc-500">{d.contentPreview}</span>
              </div>
              <button
                onClick={() => onDelete(d.id)}
                className="shrink-0 text-sm text-red-600 hover:underline dark:text-red-400"
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}
      {status === 'done' && documents.length === 0 && migrated && (
        <p className="text-sm text-zinc-500">No documents yet.</p>
      )}

      <form onSubmit={onUpload} className="flex flex-wrap items-center gap-3">
        <input ref={fileInputRef} type="file" accept=".md,.txt,.pdf" className={inputClass} />
        <button type="submit" disabled={uploading} className={primaryButtonClass}>
          {uploading ? 'Uploading…' : 'Upload'}
        </button>
      </form>
      {uploadError && <p className="text-sm text-red-600 dark:text-red-400">{uploadError}</p>}
    </section>
  );
}

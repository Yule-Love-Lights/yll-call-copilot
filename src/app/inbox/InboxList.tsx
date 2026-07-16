'use client';

// The email inbox: inbound customer emails newest-first, each expanding to
// the original message + its instantly-drafted reply (editable before
// sending), a "Check inbox now" button for the fallback GHL poll, and a
// Redraft button to regenerate. Talks to GET /api/inbox,
// POST /api/inbox/check, PATCH/POST /api/inbox/[draftId]/*. Style matches
// /queue and /call/[leadId].

import { useCallback, useEffect, useState } from 'react';

type DraftStatus = 'draft' | 'sent' | 'failed' | 'dismissed';
type EmailIntent = 'buyer' | 'question' | 'service' | 'other';

type Draft = {
  id: string;
  subject: string;
  body: string;
  intent: EmailIntent | null;
  guaranteeUsed: string | null;
  status: DraftStatus;
  createdAt: string;
  sentAt: string | null;
};

type InboundEmail = {
  id: string;
  source: 'ghl' | 'gmail';
  fromAddress: string | null;
  fromName: string | null;
  subject: string | null;
  body: string;
  receivedAt: string | null;
  intent: EmailIntent | null;
  status: 'new' | 'drafted' | 'sent' | 'dismissed';
  createdAt: string;
  draft: Draft | null;
};

type InboxResponse = {
  configured: boolean;
  migrated?: boolean;
  reason?: string;
  error?: string;
  sendEnabled?: boolean;
  emails?: InboundEmail[];
};

const cardClass = 'flex flex-col gap-3 rounded-md border border-zinc-200 p-4 dark:border-zinc-800';
const inputClass =
  'w-full rounded-md border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900';
const primaryButtonClass =
  'rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300';
const secondaryButtonClass =
  'rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-900';
const amberBannerClass =
  'rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200';

const INTENT_LABELS: Record<EmailIntent, string> = {
  buyer: 'Buyer',
  question: 'Question',
  service: 'Service',
  other: 'Other',
};

// Speed matters here -- surfacing age is how a rep sees nothing sat for
// hours (the whole point of this workstream is fast replies).
function formatAge(iso: string | null): string {
  if (!iso) return '';
  const minutes = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function statusChipClass(status: string): string {
  if (status === 'sent') return 'bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300';
  if (status === 'dismissed') return 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400';
  if (status === 'failed') return 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300';
  if (status === 'new') return 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300';
  return 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300'; // drafted / draft
}

function EmailRow({
  email,
  sendEnabled,
  onChanged,
}: {
  email: InboundEmail;
  sendEnabled: boolean;
  onChanged: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [dismissing, setDismissing] = useState(false);
  const [redrafting, setRedrafting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const draft = email.draft;

  // Seeds the editable fields from the CURRENT draft only when entering edit
  // mode (not via an effect that mirrors every draft change into state --
  // that would fight the rep's in-progress edits and is the
  // react-hooks/set-state-in-effect anti-pattern QueueList.tsx already avoids
  // the same way). A redraft always creates a fresh draft row, so the next
  // "Edit" click naturally seeds from the new one.
  function startEditing() {
    setSubject(draft?.subject ?? '');
    setBody(draft?.body ?? '');
    setEditing(true);
  }

  async function onSaveEdit() {
    if (!draft) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/inbox/${draft.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject, body }),
      });
      const json = await res.json();
      if (!json.saved) {
        setError(json.error ?? 'Could not save.');
        return;
      }
      setEditing(false);
      onChanged();
    } finally {
      setSaving(false);
    }
  }

  async function onSend() {
    if (!draft) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch(`/api/inbox/${draft.id}/send`, { method: 'POST' });
      const json = await res.json();
      if (!json.sent) setError(json.error ?? json.reason ?? 'Could not send.');
      onChanged();
    } finally {
      setSending(false);
    }
  }

  async function onDismiss() {
    if (!draft) return;
    setDismissing(true);
    setError(null);
    try {
      const res = await fetch(`/api/inbox/${draft.id}/dismiss`, { method: 'POST' });
      const json = await res.json();
      if (!json.dismissed) setError(json.error ?? 'Could not dismiss.');
      onChanged();
    } finally {
      setDismissing(false);
    }
  }

  async function onRedraft() {
    if (!draft) return;
    setRedrafting(true);
    setError(null);
    try {
      const res = await fetch(`/api/inbox/${draft.id}/redraft`, { method: 'POST' });
      const json = await res.json();
      if (!json.redrafted) setError(json.error ?? json.reason ?? 'Could not redraft.');
      setEditing(false);
      onChanged();
    } finally {
      setRedrafting(false);
    }
  }

  const canAct = draft !== null && draft.status === 'draft';

  return (
    <li className={cardClass}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-col">
          <span className="text-sm font-medium">{email.fromName ?? email.fromAddress ?? '(unknown sender)'}</span>
          <span className="text-xs text-zinc-500">{email.subject ?? '(no subject)'}</span>
        </div>
        <div className="flex items-center gap-2">
          {email.intent && (
            <span className="rounded-full border border-zinc-300 px-2 py-0.5 text-xs text-zinc-600 dark:border-zinc-700 dark:text-zinc-400">
              {INTENT_LABELS[email.intent]}
            </span>
          )}
          <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${statusChipClass(draft?.status ?? email.status)}`}>
            {draft ? draft.status : email.status}
          </span>
          <span className="text-xs text-zinc-400" title={email.receivedAt ?? email.createdAt}>
            {formatAge(email.receivedAt ?? email.createdAt)}
          </span>
          <button type="button" onClick={() => setExpanded(v => !v)} className="text-sm text-blue-600 hover:underline dark:text-blue-400">
            {expanded ? 'Hide' : 'View'}
          </button>
        </div>
      </div>

      {expanded && (
        <div className="flex flex-col gap-4 border-t border-zinc-200 pt-3 dark:border-zinc-800">
          <div>
            <h3 className="text-xs font-semibold uppercase text-zinc-500">Original email</h3>
            <p className="mt-1 whitespace-pre-wrap text-sm text-zinc-600 dark:text-zinc-400">{email.body}</p>
          </div>

          {!draft && (
            <p className="text-sm text-zinc-500">
              {email.status === 'new'
                ? 'Still drafting a reply — click "Check inbox now" in a moment to retry.'
                : 'No reply drafted.'}
            </p>
          )}

          {draft && (
            <div className="flex flex-col gap-2">
              <h3 className="text-xs font-semibold uppercase text-zinc-500">Reply draft</h3>
              {editing ? (
                <div className="flex flex-col gap-2">
                  <input value={subject} onChange={e => setSubject(e.target.value)} placeholder="Subject" className={inputClass} />
                  <textarea value={body} onChange={e => setBody(e.target.value)} rows={8} className={inputClass} />
                  <div className="flex gap-2">
                    <button onClick={onSaveEdit} disabled={saving} className={secondaryButtonClass}>
                      {saving ? 'Saving…' : 'Save'}
                    </button>
                    <button onClick={() => setEditing(false)} className="text-sm text-zinc-500 hover:underline">
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col gap-1">
                  <p className="text-sm font-medium">{draft.subject}</p>
                  <p className="whitespace-pre-wrap text-sm text-zinc-600 dark:text-zinc-400">{draft.body}</p>
                  {draft.guaranteeUsed && <p className="text-xs text-zinc-400">Guarantee used: {draft.guaranteeUsed}</p>}
                </div>
              )}

              <div className="flex flex-wrap items-center gap-3">
                {canAct && !editing && (
                  <button onClick={startEditing} className="text-sm text-blue-600 hover:underline dark:text-blue-400">
                    Edit
                  </button>
                )}
                {canAct && (
                  <button onClick={onRedraft} disabled={redrafting} className={secondaryButtonClass}>
                    {redrafting ? 'Redrafting…' : 'Redraft'}
                  </button>
                )}
                {canAct && (
                  <button onClick={onDismiss} disabled={dismissing} className={secondaryButtonClass}>
                    {dismissing ? 'Dismissing…' : 'Dismiss'}
                  </button>
                )}
                {canAct && (
                  <button
                    onClick={onSend}
                    disabled={sending || !sendEnabled || editing}
                    title={sendEnabled ? undefined : 'Sending disabled - set GHL_SEND_ENABLED=true'}
                    className={`ml-auto ${primaryButtonClass}`}
                  >
                    {sending ? 'Sending…' : 'Send reply'}
                  </button>
                )}
              </div>
              {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
            </div>
          )}
        </div>
      )}
    </li>
  );
}

export default function InboxList() {
  const [data, setData] = useState<InboxResponse | null>(null);
  const [status, setStatus] = useState<'loading' | 'done' | 'error'>('loading');
  const [checking, setChecking] = useState(false);
  const [checkMessage, setCheckMessage] = useState<string | null>(null);

  const load = useCallback(() => {
    return fetch('/api/inbox')
      .then(res => res.json())
      .then((json: InboxResponse) => {
        setData(json);
        setStatus('done');
      })
      .catch(() => setStatus('error'));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function onCheckNow() {
    setChecking(true);
    setCheckMessage(null);
    try {
      const res = await fetch('/api/inbox/check', { method: 'POST' });
      const json = await res.json();
      if (json.migrated === false) {
        setCheckMessage(json.reason ?? 'Run migration 0012 first.');
        return;
      }
      if (json.configured === false) {
        setCheckMessage('Supabase not configured.');
        return;
      }
      setCheckMessage(`Pulled ${json.pulled ?? 0}, ingested ${json.ingested ?? 0}, redrafted ${json.redrafted ?? 0}.`);
      await load();
    } catch {
      setCheckMessage('Could not check the inbox.');
    } finally {
      setChecking(false);
    }
  }

  if (status === 'loading' || !data) return <p className="text-sm text-zinc-500">Loading…</p>;
  if (status === 'error' || data.error) {
    return <p className="text-sm text-red-600 dark:text-red-400">{data.error ?? 'Could not load the inbox.'}</p>;
  }
  if (data.migrated === false) {
    return <div className={amberBannerClass}>{data.reason ?? 'Run migration 0012 first.'}</div>;
  }

  const emails = data.emails ?? [];
  const sendEnabled = data.sendEnabled === true;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Email inbox</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Fast, on-brand replies to inbound customer emails. Review and send within minutes.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button onClick={onCheckNow} disabled={checking} className={primaryButtonClass}>
          {checking ? 'Checking…' : 'Check inbox now'}
        </button>
        {checkMessage && <span className="text-sm text-zinc-500">{checkMessage}</span>}
      </div>

      {!sendEnabled && (
        <div className={amberBannerClass}>
          Sending is disabled (set GHL_SEND_ENABLED=true) — drafts still generate, review them here.
        </div>
      )}

      {emails.length === 0 && <p className="text-sm text-zinc-500">No inbound emails yet.</p>}

      <ul className="flex flex-col gap-3">
        {emails.map(email => (
          <EmailRow key={email.id} email={email} sendEnabled={sendEnabled} onChanged={load} />
        ))}
      </ul>
    </div>
  );
}

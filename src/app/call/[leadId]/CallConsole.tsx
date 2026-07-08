'use client';

// The call console: contact card + quote-stage context (left), the active
// playbook for the lead's vertical with the matching opener auto-expanded
// (center), and outcome tagging + notes + paste-transcript + follow-up
// drafts (right). Talks to GET /api/leads/[leadId] to load everything and
// POST /api/calls to save.

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CALL_OUTCOMES, FOLLOWUP_OUTCOMES, type CallOutcome } from '@/lib/leads/types';

type LeadDetail = {
  id: string;
  ghlContactId: string | null;
  fullName: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  verticalSlug: string | null;
  reason: string;
  openerHint: string | null;
  score: number;
  source: string;
  status: 'queued' | 'claimed' | 'done' | 'dismissed';
  claimedBy: string | null;
  queuedAt: string;
};

type Contact = {
  fullName?: string;
  email?: string;
  phone?: string;
  address1?: string;
  city?: string;
  state?: string;
  postalCode?: string;
};

type Playbook = {
  icp: string;
  angles: string[];
  openers: { label: string; script: string }[];
  objections: { objection: string; response: string }[];
  avoid: string[];
  voicemail: string;
};

type TopObjection = { objection: string; count: number; pct: number };

type Followup = {
  id: string;
  kind: 'email' | 'sms';
  toAddress: string;
  subject: string | null;
  body: string;
  status: 'draft' | 'approved_sent' | 'failed';
  createdAt: string;
  sentAt: string | null;
};

type DetailResponse = {
  configured: boolean;
  migrated?: boolean;
  reason?: string;
  error?: string;
  sendEnabled?: boolean;
  callableNow?: boolean;
  lead?: LeadDetail;
  contact?: Contact | null;
  contactUrl?: string | null;
  quoteStage?: string | null;
  vertical?: { id: string; slug: string; name: string } | null;
  playbook?: Playbook | null;
  topObjections?: TopObjection[];
  latestCall?: { id: string; outcome: CallOutcome | null; notes: string | null; startedAt: string } | null;
  followups?: Followup[];
};

const OUTCOME_LABELS: Record<CallOutcome, string> = {
  interested: 'Interested',
  callback: 'Callback',
  not_interested: 'Not interested',
  wrong_number: 'Wrong number',
  voicemail: 'Voicemail',
  no_answer: 'No answer',
};

const cardClass = 'flex flex-col gap-3 rounded-md border border-zinc-200 p-4 dark:border-zinc-800';
const inputClass =
  'w-full rounded-md border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900';
const primaryButtonClass =
  'rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300';
const secondaryButtonClass =
  'rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-900';

function ContactCard({
  lead,
  contact,
  contactUrl,
  quoteStage,
}: {
  lead: LeadDetail;
  contact: Contact | null | undefined;
  contactUrl: string | null | undefined;
  quoteStage: string | null | undefined;
}) {
  const [copied, setCopied] = useState(false);
  const phone = contact?.phone ?? lead.phone;

  async function copyPhone() {
    if (!phone) return;
    try {
      await navigator.clipboard.writeText(phone);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard access can be denied by the browser — not worth surfacing
      // as an error, the phone number is still visible to copy by hand.
    }
  }

  return (
    <section className={cardClass}>
      <h2 className="text-sm font-semibold">Contact</h2>
      <p className="text-lg font-medium">{contact?.fullName ?? lead.fullName ?? '(no name)'}</p>

      {phone && (
        <button type="button" onClick={copyPhone} className="self-start text-sm text-blue-600 hover:underline dark:text-blue-400">
          {phone} {copied ? '(copied)' : '(click to copy)'}
        </button>
      )}
      {(contact?.email ?? lead.email) && <p className="text-sm text-zinc-500">{contact?.email ?? lead.email}</p>}
      {(contact?.address1 ?? lead.address) && <p className="text-sm text-zinc-500">{contact?.address1 ?? lead.address}</p>}

      {contactUrl && (
        <a href={contactUrl} target="_blank" rel="noreferrer" className="self-start text-sm text-blue-600 hover:underline dark:text-blue-400">
          Open in GoHighLevel →
        </a>
      )}

      <div className="mt-2 flex flex-col gap-1 border-t border-zinc-200 pt-3 dark:border-zinc-800">
        <p className="text-sm font-medium">{lead.reason}</p>
        <p className="text-xs text-zinc-500">
          Score {lead.score} · {lead.source}
        </p>
        {quoteStage && <p className="text-xs text-zinc-500">Quote stage: {quoteStage}</p>}
      </div>
    </section>
  );
}

function PlaybookPanel({
  playbook,
  openerHint,
  topObjections,
}: {
  playbook: Playbook | null | undefined;
  openerHint: string | null | undefined;
  topObjections: TopObjection[] | undefined;
}) {
  if (!playbook) {
    return (
      <section className={cardClass}>
        <h2 className="text-sm font-semibold">Playbook</h2>
        <p className="text-sm text-zinc-500">No playbook available for this lead&apos;s vertical yet.</p>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-4">
      <div className={cardClass}>
        <h2 className="text-sm font-semibold">Openers</h2>
        {playbook.openers.map((o, i) => (
          <details key={i} open={o.label === openerHint} className="rounded-md border border-zinc-200 p-2 dark:border-zinc-800">
            <summary className="cursor-pointer text-sm font-medium">{o.label}</summary>
            <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">{o.script}</p>
          </details>
        ))}
      </div>

      <div className={cardClass}>
        <h2 className="text-sm font-semibold">Objections</h2>
        {(topObjections?.length ?? 0) > 0 && (
          <div className="rounded-md bg-zinc-50 p-2 text-xs text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
            <p className="font-medium">Frequently raised for this vertical:</p>
            <ul className="mt-1 list-disc pl-4">
              {topObjections!.map(o => (
                <li key={o.objection}>
                  {o.objection} ({o.pct}%)
                </li>
              ))}
            </ul>
          </div>
        )}
        {playbook.objections.map((o, i) => (
          <details key={i} className="rounded-md border border-zinc-200 p-2 dark:border-zinc-800">
            <summary className="cursor-pointer text-sm font-medium">{o.objection}</summary>
            <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">{o.response}</p>
          </details>
        ))}
      </div>

      <div className={cardClass}>
        <h2 className="text-sm font-semibold">Avoid</h2>
        <ul className="list-disc pl-5 text-sm">
          {playbook.avoid.map((a, i) => (
            <li key={i}>{a}</li>
          ))}
        </ul>
      </div>

      <div className={cardClass}>
        <h2 className="text-sm font-semibold">Voicemail script</h2>
        <p className="text-sm">{playbook.voicemail}</p>
      </div>
    </section>
  );
}

function FollowupCard({ followup, sendEnabled, onSaved }: { followup: Followup; sendEnabled: boolean; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  const [subject, setSubject] = useState(followup.subject ?? '');
  const [body, setBody] = useState(followup.body);
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSaveEdit() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/followups/${followup.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(followup.kind === 'email' ? { subject, body } : { body }),
      });
      const json = await res.json();
      if (!json.saved) {
        setError(json.error ?? 'Could not save.');
        return;
      }
      setEditing(false);
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  async function onSend() {
    setSending(true);
    setError(null);
    try {
      const res = await fetch(`/api/followups/${followup.id}/send`, { method: 'POST' });
      const json = await res.json();
      if (!json.sent) {
        setError(json.error ?? json.reason ?? 'Could not send.');
      }
      onSaved();
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium uppercase text-zinc-500">{followup.kind}</span>
        <span className="text-xs text-zinc-400">{followup.toAddress}</span>
      </div>

      {editing ? (
        <div className="flex flex-col gap-2">
          {followup.kind === 'email' && (
            <input value={subject} onChange={e => setSubject(e.target.value)} placeholder="Subject" className={inputClass} />
          )}
          <textarea value={body} onChange={e => setBody(e.target.value)} rows={4} className={inputClass} />
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
          {followup.subject && <p className="text-sm font-medium">{followup.subject}</p>}
          <p className="whitespace-pre-wrap text-sm text-zinc-600 dark:text-zinc-400">{followup.body}</p>
        </div>
      )}

      <div className="flex items-center gap-3">
        <span
          className={`text-xs font-medium ${
            followup.status === 'approved_sent'
              ? 'text-green-700 dark:text-green-400'
              : followup.status === 'failed'
                ? 'text-red-600 dark:text-red-400'
                : 'text-zinc-500'
          }`}
        >
          {followup.status === 'approved_sent' ? 'Sent' : followup.status === 'failed' ? 'Failed to send' : 'Draft'}
        </span>

        {followup.status === 'draft' && !editing && (
          <button onClick={() => setEditing(true)} className="text-sm text-blue-600 hover:underline dark:text-blue-400">
            Edit
          </button>
        )}

        {followup.status !== 'approved_sent' && (
          <button
            onClick={onSend}
            disabled={sending || !sendEnabled || editing}
            title={sendEnabled ? undefined : 'Sending disabled - set GHL_SEND_ENABLED=true'}
            className={`ml-auto ${primaryButtonClass}`}
          >
            {sending ? 'Sending…' : 'Send via GHL'}
          </button>
        )}
      </div>
      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}

export default function CallConsole({ leadId, initialCallId = null }: { leadId: string; initialCallId?: string | null }) {
  const router = useRouter();
  const [data, setData] = useState<DetailResponse | null>(null);
  const [status, setStatus] = useState<'loading' | 'done' | 'error'>('loading');

  const [outcome, setOutcome] = useState<CallOutcome | null>(null);
  const [notes, setNotes] = useState('');
  const [transcript, setTranscript] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  // The call POST /api/live/end just created, carried here via ?callId= so
  // the first save updates it instead of inserting a second `calls` row.
  // Cleared after a successful save: logging a second outcome for this same
  // lead later in this page's lifetime should insert a fresh call, not keep
  // overwriting the live-coached one.
  const [pendingCallId, setPendingCallId] = useState<string | null>(initialCallId);

  const load = useCallback(() => {
    return fetch(`/api/leads/${leadId}`)
      .then(res => res.json())
      .then((json: DetailResponse) => {
        setData(json);
        setStatus('done');
      })
      .catch(() => setStatus('error'));
  }, [leadId]);

  useEffect(() => {
    load();
  }, [load]);

  // A stale ?callId= surviving in the URL (a refresh, browser back/forward,
  // or a restored tab on this same /call/[leadId]?callId=X after that call
  // already saved) must not re-arm as an update target once the lead itself
  // shows as already 'done' -- logging a new outcome at that point should
  // insert a fresh call, never UPDATE the one that finished it. Derived at
  // use rather than corrected via an effect (no setState-in-effect this
  // way); stripping the param from the URL on save below closes the more
  // common case (a fresh reload of the SAME tab), this covers a stale tab
  // that never reloaded.
  const effectiveCallId = data?.lead?.status === 'done' ? null : pendingCallId;

  async function onSave() {
    if (!outcome) return;
    setSaving(true);
    setSaveMessage(null);
    setSaveError(null);
    try {
      const res = await fetch('/api/calls', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          leadId,
          outcome,
          notes,
          transcript: transcript || undefined,
          callId: effectiveCallId ?? undefined,
          // The lead's own source says whether this call started as an
          // inbound webhook hit (see GET /api/inbound/recent) or one of the
          // queue's outbound sources — previously every insert here
          // hardcoded 'outbound' regardless, permanently mislabeling every
          // inbound-originated call.
          direction: data?.lead?.source === 'inbound' ? 'inbound' : 'outbound',
        }),
      });
      const json = await res.json();
      if (!json.saved) {
        setSaveError(json.error ?? json.reason ?? 'Could not save the call.');
        return;
      }
      setPendingCallId(null);
      // Strip ?callId= now that it has done its job -- otherwise a later
      // refresh or back/forward navigation on this same URL re-arms
      // pendingCallId to the call we just finished, and a second, separate
      // outcome logged in this tab would silently UPDATE it instead of
      // inserting a fresh row (see POST /api/calls's callId branch).
      router.replace(`/call/${leadId}`);

      const parts = ['Call saved.'];
      if (json.transcript?.created) {
        parts.push(
          json.transcript.extraction?.attempted
            ? `Extracted learnings from the transcript (${json.transcript.extraction.done} done, ${json.transcript.extraction.failed} failed).`
            : 'Transcript stored (no vertical matched, so learnings were not extracted).',
        );
      }
      if (json.followups?.generated) {
        parts.push(`Generated ${json.followups.count} follow-up draft(s).`);
      } else if (json.followups?.reason && (FOLLOWUP_OUTCOMES as string[]).includes(outcome)) {
        parts.push(json.followups.reason);
      }
      setSaveMessage(parts.join(' '));
      setNotes('');
      setTranscript('');
      setOutcome(null);
      await load();
    } catch {
      // A dropped connection, proxy/timeout error, or a non-JSON error page
      // (res.json() throwing) must not look like nothing happened -- the
      // outcome/notes/transcript below are left exactly as the rep typed
      // them (none of the success-path resets above ran).
      setSaveError('Could not save the call — check your connection and try again. Your notes have not been lost.');
    } finally {
      setSaving(false);
    }
  }

  if (status === 'loading' || !data) return <p className="text-sm text-zinc-500">Loading…</p>;
  if (status === 'error' || data.error) {
    return <p className="text-sm text-red-600 dark:text-red-400">{data.error ?? 'Could not load this lead.'}</p>;
  }
  if (data.migrated === false) {
    return (
      <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
        {data.reason ?? 'Run migration 0004 first.'}
      </div>
    );
  }
  if (!data.lead) return <p className="text-sm text-red-600 dark:text-red-400">Lead not found.</p>;

  const lead = data.lead;
  const sendEnabled = data.sendEnabled === true;

  return (
    <div className="flex flex-col gap-4">
      {data.callableNow === false && (
        <div className="rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900 dark:border-red-700 dark:bg-red-950 dark:text-red-200">
          Outside calling hours for this contact right now (TCPA quiet hours: 8am-9pm their local time).
        </div>
      )}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_minmax(0,1.2fr)]">
        <ContactCard lead={lead} contact={data.contact} contactUrl={data.contactUrl} quoteStage={data.quoteStage} />

        <PlaybookPanel playbook={data.playbook} openerHint={lead.openerHint} topObjections={data.topObjections} />

        <section className="flex flex-col gap-4">
          <div className={cardClass}>
            <h2 className="text-sm font-semibold">Outcome</h2>
            <div className="grid grid-cols-2 gap-2">
              {CALL_OUTCOMES.map(o => (
                <button
                  key={o}
                  type="button"
                  onClick={() => setOutcome(o)}
                  className={`rounded-md border px-3 py-2 text-sm font-medium ${
                    outcome === o
                      ? 'border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900'
                      : 'border-zinc-300 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900'
                  }`}
                >
                  {OUTCOME_LABELS[o]}
                </button>
              ))}
            </div>

            <label className="mt-2 text-sm font-semibold" htmlFor="notes">
              Notes
            </label>
            <textarea id="notes" value={notes} onChange={e => setNotes(e.target.value)} rows={4} className={inputClass} />

            <label className="text-sm font-semibold" htmlFor="transcript">
              Paste transcript (optional)
            </label>
            <textarea
              id="transcript"
              value={transcript}
              onChange={e => setTranscript(e.target.value)}
              rows={6}
              placeholder="Paste the full call transcript here to extract learnings."
              className={inputClass}
            />

            <button onClick={onSave} disabled={saving || !outcome} className={primaryButtonClass}>
              {saving ? 'Saving…' : 'Save call'}
            </button>
            {saveMessage && <p className="text-sm text-zinc-500">{saveMessage}</p>}
            {saveError && <p className="text-sm text-red-600 dark:text-red-400">{saveError}</p>}
          </div>

          {(data.followups?.length ?? 0) > 0 && (
            <div className={cardClass}>
              <h2 className="text-sm font-semibold">Follow-up drafts</h2>
              {data.followups!.map(f => (
                <FollowupCard key={f.id} followup={f} sendEnabled={sendEnabled} onSaved={load} />
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

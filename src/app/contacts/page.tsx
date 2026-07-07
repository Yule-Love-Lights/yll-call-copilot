// /contacts — search GoHighLevel contacts. Server component so we can check
// config server-side and show a friendly banner instead of a broken search
// box when the GHL env vars are missing.

import Link from 'next/link';
import { isHighLevelConfigured } from '@/lib/ghl/client';
import ContactSearch from './ContactSearch';

// Config is read per-request, not baked at build time — otherwise the
// "not configured" banner could stick after the env vars are added.
export const dynamic = 'force-dynamic';

export default function ContactsPage() {
  const configured = isHighLevelConfigured();

  return (
    <main className="mx-auto w-full max-w-2xl px-6 py-12">
      <Link href="/" className="text-sm text-zinc-500 hover:underline">
        ← Dashboard
      </Link>
      <h1 className="mt-2 text-2xl font-semibold">Contacts</h1>
      <p className="mt-1 text-sm text-zinc-500">Search GoHighLevel contacts.</p>

      <div className="mt-8">
        {configured ? (
          <ContactSearch />
        ) : (
          <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
            GHL not configured — set HIGHLEVEL_API_KEY and HIGHLEVEL_LOCATION_ID in .env.local.
          </div>
        )}
      </div>
    </main>
  );
}

// /practice/[id] — the live practice room (or, once ended, the practice
// feedback card). Thin server wrapper: the room itself is a client
// component (Web Speech API is browser-only).

import PracticeRoom from './PracticeRoom';

export const dynamic = 'force-dynamic';

export default async function PracticeSessionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  return (
    <main className="coach-surface mx-auto w-full max-w-2xl px-4 py-12 sm:px-6">
      <PracticeRoom sessionId={id} />
    </main>
  );
}

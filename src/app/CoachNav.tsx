'use client';

// The signed-in shell nav, rendered once from layout.tsx above every page
// (PR 2 of 3, the mockup's Mock 1 glass nav). Hidden on /login only -- the
// proxy already redirects a signed-out visitor there before this ever
// mounts for real, so the pathname check just keeps the sign-in screen
// itself nav-free.
//
// Active route is a pill (usePathname), grouped under tiny uppercase
// labels matching the mockup. /coach is an EXACT match for "My cards" so
// that visiting /coach/calls, /coach/rubric, or /coach/offer -- each its
// own nav item -- doesn't also light up "My cards".
//
// The two gold count badges (My cards, Inbox) fetch once on mount and never
// poll -- a stale-by-a-few-minutes badge is fine for a nav, and polling
// every page load would be wasted reads on the two unseen-count routes.

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

type NavItem = { label: string; href: string; isActive: (pathname: string) => boolean; badge?: 'feedback' | 'inbox' };
type NavGroup = { label: string; items: NavItem[] };

const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Coaching',
    items: [
      { label: 'My cards', href: '/coach', isActive: p => p === '/coach', badge: 'feedback' },
      { label: 'Call review', href: '/coach/calls', isActive: p => p.startsWith('/coach/calls') },
      { label: 'Digest', href: '/digest', isActive: p => p.startsWith('/digest') },
      { label: 'Board', href: '/scoreboard', isActive: p => p.startsWith('/scoreboard') },
    ],
  },
  {
    label: 'Queues',
    items: [
      { label: 'Inbox', href: '/inbox', isActive: p => p.startsWith('/inbox'), badge: 'inbox' },
      { label: 'Second mile', href: '/second-mile', isActive: p => p.startsWith('/second-mile') },
      { label: 'Recordings', href: '/recordings', isActive: p => p.startsWith('/recordings') },
    ],
  },
  {
    label: 'Settings',
    items: [
      { label: 'Rubric', href: '/coach/rubric', isActive: p => p.startsWith('/coach/rubric') },
      { label: 'Offer', href: '/coach/offer', isActive: p => p.startsWith('/coach/offer') },
    ],
  },
];

const activePillClass =
  'rounded-full bg-[var(--brand-evergreen)] px-3 py-1.5 font-bold text-[var(--brand-cream)] shadow-[0_2px_10px_rgba(11,20,15,0.25)]';
const inactivePillClass =
  'rounded-full px-3 py-1.5 text-[var(--op-text-2)] transition-colors hover:bg-[rgba(11,20,15,0.05)]';

function CountBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className="ml-1.5 inline-flex min-w-[18px] items-center justify-center rounded-full bg-gradient-to-r from-[var(--brand-gold)] to-[var(--brand-gold-bright)] px-1.5 py-0.5 text-[11px] font-extrabold text-[var(--brand-evergreen)] shadow-[0_1px_6px_rgba(232,184,98,0.5)] motion-safe:animate-[coach-shimmer_3.4s_ease-in-out_infinite]">
      {count}
    </span>
  );
}

export default function CoachNav() {
  const pathname = usePathname();
  const [feedbackCount, setFeedbackCount] = useState(0);
  const [inboxCount, setInboxCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/feedback/unseen-count')
      .then(res => res.json())
      .then(json => {
        if (!cancelled) setFeedbackCount(json.count ?? 0);
      })
      .catch(() => {});
    fetch('/api/inbox/unseen-count')
      .then(res => res.json())
      .then(json => {
        if (!cancelled) setInboxCount(json.count ?? 0);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  if (pathname === '/login') return null;

  const countFor = (badge?: 'feedback' | 'inbox') => {
    if (badge === 'feedback') return feedbackCount;
    if (badge === 'inbox') return inboxCount;
    return 0;
  };

  return (
    <nav className="flex flex-wrap items-center gap-x-5 gap-y-2 overflow-x-auto border-b border-[var(--op-border)] bg-white/80 px-5 py-3 text-[13.5px] backdrop-blur-md [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <Link href="/" className="mr-1 whitespace-nowrap text-[15px] font-extrabold tracking-[-.01em] text-[var(--op-text)]">
        YLL <span className="text-[var(--brand-gold-deep)]">Coach</span>
      </Link>
      {NAV_GROUPS.map(group => (
        <div key={group.label} className="flex items-center gap-1.5 whitespace-nowrap">
          <b className="mr-0.5 text-[10px] font-extrabold uppercase tracking-[.18em] text-[var(--brand-cream-dim)]">
            {group.label}
          </b>
          {group.items.map(item => (
            <Link
              key={item.href}
              href={item.href}
              className={item.isActive(pathname) ? activePillClass : inactivePillClass}
            >
              {item.label}
              <CountBadge count={countFor(item.badge)} />
            </Link>
          ))}
        </div>
      ))}
    </nav>
  );
}

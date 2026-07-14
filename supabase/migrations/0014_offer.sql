-- RLS: service-role only, same convention as 0001-0006.
-- Offer elements: the guarantees and offer moves from the sales excellence
-- plan (the 48-hour fast fix, all-inclusive pricing, lease disclosure, the
-- permanent labor warranty, the referral ask, the rebook lock, the permanent
-- seed) as structured, versioned data -- global, not per-vertical, since one
-- offer applies across the whole business and is edited from Settings.
-- Same version-history shape as playbook_versions (0002_playbooks.sql): the
-- active offer is the highest version row, an edit inserts version n+1, and
-- a rollback re-saves an old version's content as a new version -- history
-- is never rewritten.
--
-- The `content` shape is a pinned contract other workstreams read at
-- runtime: the after-call scorer grades whether the rep said each element's
-- customer_line per its grade_hint, and the email drafter quotes
-- customer_line directly. See src/lib/offer/store.ts for the TypeScript
-- shape and the DEFAULT_OFFER_CONTENT fallback used if this table or its
-- seed row is ever missing.
--
-- File only -- not applied anywhere yet, same convention as 0001-0006.

create table offer_versions (
  id uuid primary key default gen_random_uuid(),
  version int not null unique,
  content jsonb not null,
  source text not null check (source in ('seeded', 'edited')),
  created_at timestamptz default now()
);

insert into offer_versions (version, content, source) values (
  1,
  $offer$
  {
    "elements": [
      {
        "key": "fast_fix_48h",
        "name": "48-Hour Fast Fix",
        "customer_line": "If any section of your display goes dark between Thanksgiving and New Year's, we fix it within 48 hours or that month is free.",
        "grade_hint": "stated the 48-hour promise with its number on the call.",
        "applies_to": "holiday",
        "situational": false,
        "active": true
      },
      {
        "key": "all_inclusive",
        "name": "All-Inclusive Pricing",
        "customer_line": "Design, install, all-season service, takedown, storage, all in the number. The quote is the bill. No hidden fees.",
        "grade_hint": "said all-inclusive plainly, no fee surprises left open.",
        "applies_to": "all",
        "situational": false,
        "active": true
      },
      {
        "key": "lease_disclosure",
        "name": "Lease Disclosure",
        "customer_line": "We own the lights, store them, and reuse them every year. You are buying a done-for-you display, not hardware, and that is exactly why we can promise the 48-hour fix.",
        "grade_hint": "made ownership plain in one sentence, framed as the off-your-plate benefit.",
        "applies_to": "holiday",
        "situational": false,
        "active": true
      },
      {
        "key": "labor_warranty_3yr",
        "name": "3-Year Labor Warranty",
        "customer_line": "Three years of labor coverage on the installation, not just parts. Most companies advertise lifetime parts and quietly cap labor at one year.",
        "grade_hint": "stated labor parity loudly as the differentiator.",
        "applies_to": "permanent",
        "situational": false,
        "active": true
      },
      {
        "key": "referral_ask",
        "name": "Referral Ask",
        "customer_line": "$100 credit for you, and your friend gets two free spritzers on us.",
        "grade_hint": "asked for the referral on a happy-customer call, not graded on a frustrated caller.",
        "applies_to": "all",
        "situational": true,
        "active": true
      },
      {
        "key": "rebook_lock",
        "name": "Rebook Lock",
        "customer_line": "Your spot and this year's price are held until [date]. One yes and you are on next year's schedule.",
        "grade_hint": "offered to lock next season at takedown or on a happy end-of-season call.",
        "applies_to": "holiday",
        "situational": true,
        "active": true
      },
      {
        "key": "permanent_seed",
        "name": "Permanent Seed",
        "customer_line": "Since our crew is already on your roofline, want them to measure for permanent lighting while they are up there? No cost, no commitment.",
        "grade_hint": "planted only when the fit was there: past holiday customer, takedown call, ladder-averse homeowner. Grading it on every call is wrong.",
        "applies_to": "holiday",
        "situational": true,
        "active": true
      }
    ],
    "financing_note": "Wisetack financing is presented as a monthly number beside the cash price on permanent and genuine whole-home holiday only. Standard holiday stays cash and card, on purpose."
  }
  $offer$::jsonb,
  'seeded'
);

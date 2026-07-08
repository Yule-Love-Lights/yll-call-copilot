// The 4 default Yule Love Lights verticals + the idempotency check for
// seeding them. The check is a plain function of "how many verticals already
// exist" so it is unit-testable without a live Supabase client — the route
// (src/app/api/verticals/seed/route.ts) does the actual DB count + insert.

export type DefaultVertical = {
  slug: string;
  name: string;
  description: string;
};

export const DEFAULT_VERTICALS: DefaultVertical[] = [
  {
    slug: 'holiday',
    name: 'Holiday Lighting',
    description: 'Residential holiday light installs, seasonal booking Aug-Nov.',
  },
  {
    slug: 'permanent',
    name: 'Permanent Lighting',
    description: 'Permanent exterior track lighting, year-round, upsell to past holiday customers.',
  },
  {
    slug: 'event',
    name: 'Event Lighting',
    description: 'Event lighting: weddings, parties, temporary installs.',
  },
  {
    slug: 'commercial',
    name: 'Commercial Lighting',
    description: 'Commercial storefronts, HOAs, property managers.',
  },
];

// Only seed when the table is empty — this is what makes a second call a
// no-op instead of inserting duplicates.
export function shouldSeedDefaults(existingVerticalCount: number): boolean {
  return existingVerticalCount === 0;
}

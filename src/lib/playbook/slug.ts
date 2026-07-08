// Turns a display name into a URL-safe, lowercase, hyphenated slug for the
// `verticals.slug` column. Shared by vertical creation and the default seed.
export function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'vertical';
}

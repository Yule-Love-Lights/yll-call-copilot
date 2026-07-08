// Claude sometimes fills tool-call array fields with XML-tagged text
// ("<angle>...</angle>") or a JSON-encoded string instead of a real JSON
// array (seen live on 2026-07-07). Recover the two obvious cases before
// validation; anything else still fails validation and goes to the retry.
export function normalizePlaybookInput(input: unknown): unknown {
  if (typeof input !== 'object' || input === null) return input;
  const out: Record<string, unknown> = { ...(input as Record<string, unknown>) };

  for (const key of ['angles', 'openers', 'objections', 'avoid'] as const) {
    const v = out[key];
    if (typeof v !== 'string') continue;
    const s = v.trim();

    // Case 1: the field is a JSON array/object encoded as a string.
    if (s.startsWith('[') || s.startsWith('{')) {
      try {
        out[key] = JSON.parse(s);
        continue;
      } catch {
        // fall through to the tag scan
      }
    }

    // Case 2: items wrapped in repeated XML-ish tags.
    const tagged = [...s.matchAll(/<([a-zA-Z_]+)>([\s\S]*?)<\/\1>/g)].map((m) => m[2].trim());
    if (tagged.length > 0) {
      out[key] = tagged;
    }
  }

  return out;
}

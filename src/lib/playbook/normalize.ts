// Claude sometimes fills tool-call array fields with XML-tagged text
// ("<angle>...</angle>"), a JSON-encoded string, or an array of one-key
// objects ([{angle: "..."}]) instead of the declared shape (all three seen
// live on 2026-07-07/08). Recover the obvious cases before validation;
// anything else still fails validation and goes to the retry.

// Arrays of objects where each object is really just a wrapped string:
// [{angle:"x"}], [{text:"x"}], [{value:"x"}] → ["x"]. Only transforms when
// EVERY element recovers, so mixed/ambiguous shapes still fail validation.
export function unwrapObjectStringArray(v: unknown): unknown {
  if (!Array.isArray(v) || v.length === 0) return v;
  if (!v.every((el) => typeof el === 'object' && el !== null && !Array.isArray(el))) return v;
  const mapped = v.map((el) => {
    const r = el as Record<string, unknown>;
    if (typeof r.text === 'string') return r.text;
    if (typeof r.value === 'string') return r.value;
    const keys = Object.keys(r);
    if (keys.length === 1 && typeof r[keys[0]] === 'string') return r[keys[0]];
    return null;
  });
  return mapped.every((m) => typeof m === 'string') ? mapped : v;
}

export function normalizePlaybookInput(input: unknown): unknown {
  if (typeof input !== 'object' || input === null) return input;
  const out: Record<string, unknown> = { ...(input as Record<string, unknown>) };

  for (const key of ['angles', 'openers', 'objections', 'avoid'] as const) {
    const v = out[key];

    // String-array fields that arrived as arrays of wrapped-string objects.
    if ((key === 'angles' || key === 'avoid') && Array.isArray(v)) {
      out[key] = unwrapObjectStringArray(v);
      continue;
    }

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

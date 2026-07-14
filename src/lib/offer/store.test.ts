import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { DEFAULT_OFFER_CONTENT, getActiveOffer, saveOfferEdit, validateOfferContent } from './store';
import type { OfferContent } from './store';

function content(financingNote = 'note'): OfferContent {
  return { elements: DEFAULT_OFFER_CONTENT.elements, financing_note: financingNote };
}

// ---- validateOfferContent -------------------------------------------------

describe('validateOfferContent', () => {
  it('accepts the well-formed default content (all seven canonical keys)', () => {
    const result = validateOfferContent(DEFAULT_OFFER_CONTENT);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.content).toEqual(DEFAULT_OFFER_CONTENT);
    }
  });

  it('rejects content missing one of the seven canonical keys', () => {
    const missingReferral = {
      ...DEFAULT_OFFER_CONTENT,
      elements: DEFAULT_OFFER_CONTENT.elements.filter(el => el.key !== 'referral_ask'),
    };
    const result = validateOfferContent(missingReferral);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.error).toMatch(/referral_ask/);
  });

  it('rejects duplicate element keys', () => {
    const duplicated = {
      ...DEFAULT_OFFER_CONTENT,
      elements: [...DEFAULT_OFFER_CONTENT.elements, { ...DEFAULT_OFFER_CONTENT.elements[0] }],
    };
    const result = validateOfferContent(duplicated);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.error).toMatch(/duplicate/i);
  });

  it('rejects an element with the wrong field types (situational as a string)', () => {
    const badTypes = {
      ...DEFAULT_OFFER_CONTENT,
      elements: DEFAULT_OFFER_CONTENT.elements.map(el =>
        el.key === 'fast_fix_48h' ? { ...el, situational: 'true' } : el,
      ),
    };
    const result = validateOfferContent(badTypes);
    expect(result.valid).toBe(false);
  });

  it('rejects an element with an empty customer_line', () => {
    const emptyLine = {
      ...DEFAULT_OFFER_CONTENT,
      elements: DEFAULT_OFFER_CONTENT.elements.map(el =>
        el.key === 'fast_fix_48h' ? { ...el, customer_line: '   ' } : el,
      ),
    };
    const result = validateOfferContent(emptyLine);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.error).toMatch(/customer_line/);
  });

  it('rejects a non-object value', () => {
    expect(validateOfferContent(null).valid).toBe(false);
    expect(validateOfferContent('nope').valid).toBe(false);
    expect(validateOfferContent(42).valid).toBe(false);
  });

  it('rejects a missing financing_note', () => {
    const noNote: Record<string, unknown> = { elements: DEFAULT_OFFER_CONTENT.elements };
    const result = validateOfferContent(noNote);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.error).toMatch(/financing_note/);
  });

  it('accepts extra custom elements on top of the seven canonical ones', () => {
    const withExtra = {
      ...DEFAULT_OFFER_CONTENT,
      elements: [
        ...DEFAULT_OFFER_CONTENT.elements,
        {
          key: 'custom_bonus',
          name: 'Custom Bonus',
          customer_line: 'A bonus line.',
          grade_hint: 'a custom hint.',
          applies_to: 'all',
          situational: true,
          active: true,
        },
      ],
    };
    expect(validateOfferContent(withExtra).valid).toBe(true);
  });
});

// ---- getActiveOffer ---------------------------------------------------------

function fakeSupabaseForRead(opts: {
  data?: { version: number; content: OfferContent; source: 'seeded' | 'edited' } | null;
  error?: { code?: string; message: string } | null;
}) {
  const from = vi.fn((table: string) => {
    if (table !== 'offer_versions') throw new Error(`Unexpected table: ${table}`);
    return {
      select: () => ({
        order: () => ({
          limit: () => ({
            maybeSingle: () =>
              Promise.resolve({ data: opts.data ?? null, error: opts.error ?? null }),
          }),
        }),
      }),
    };
  });
  return { from } as unknown as SupabaseClient;
}

describe('getActiveOffer', () => {
  it('returns the newest version content when a row exists', async () => {
    const client = fakeSupabaseForRead({
      data: { version: 3, content: content('v3 note'), source: 'edited' },
    });
    const result = await getActiveOffer(client);
    expect(result).toEqual({ content: content('v3 note'), version: 3, source: 'edited' });
  });

  it('falls back to DEFAULT_OFFER_CONTENT when the table is missing (PGRST205)', async () => {
    const client = fakeSupabaseForRead({ error: { code: 'PGRST205', message: 'missing table' } });
    const result = await getActiveOffer(client);
    expect(result).toEqual({ content: DEFAULT_OFFER_CONTENT, version: null, source: null });
  });

  it('falls back to DEFAULT_OFFER_CONTENT when the table is missing (42P01)', async () => {
    const client = fakeSupabaseForRead({ error: { code: '42P01', message: 'undefined_table' } });
    const result = await getActiveOffer(client);
    expect(result).toEqual({ content: DEFAULT_OFFER_CONTENT, version: null, source: null });
  });

  it('falls back to DEFAULT_OFFER_CONTENT when the table is empty', async () => {
    const client = fakeSupabaseForRead({ data: null, error: null });
    const result = await getActiveOffer(client);
    expect(result).toEqual({ content: DEFAULT_OFFER_CONTENT, version: null, source: null });
  });
});

// ---- saveOfferEdit -----------------------------------------------------------

type FakeSaveOpts = {
  latestVersions: (number | null)[]; // one value consumed per select call, last one repeats
  insertErrorCodes?: (string | null)[]; // one entry consumed per insert call
  readErrorCode?: string;
};

function fakeSupabaseForSave(opts: FakeSaveOpts) {
  let readCallIndex = 0;
  let insertCallIndex = 0;
  const insertedRows: { version: number; content: OfferContent; source: string }[] = [];

  const from = vi.fn((table: string) => {
    if (table !== 'offer_versions') throw new Error(`Unexpected table: ${table}`);
    return {
      select: () => ({
        order: () => ({
          limit: () => ({
            maybeSingle: () => {
              if (opts.readErrorCode) {
                return Promise.resolve({ data: null, error: { code: opts.readErrorCode, message: 'read failed' } });
              }
              const idx = Math.min(readCallIndex, opts.latestVersions.length - 1);
              readCallIndex++;
              const version = opts.latestVersions[idx];
              return Promise.resolve({ data: version === null ? null : { version }, error: null });
            },
          }),
        }),
      }),
      insert: (row: { version: number; content: OfferContent; source: string }) => {
        const code = (opts.insertErrorCodes ?? [])[insertCallIndex] ?? null;
        insertCallIndex++;
        if (code) return Promise.resolve({ error: { code, message: 'insert failed' } });
        insertedRows.push(row);
        return Promise.resolve({ error: null });
      },
    };
  });

  return { client: { from } as unknown as SupabaseClient, insertedRows };
}

describe('saveOfferEdit', () => {
  it('bumps the version by 1 on the happy path', async () => {
    const { client, insertedRows } = fakeSupabaseForSave({ latestVersions: [2] });

    const result = await saveOfferEdit(client, content());

    expect(result).toEqual({ ok: true, version: 3 });
    expect(insertedRows).toEqual([{ version: 3, content: content(), source: 'edited' }]);
  });

  it('starts at version 1 when the table is empty', async () => {
    const { client, insertedRows } = fakeSupabaseForSave({ latestVersions: [null] });

    const result = await saveOfferEdit(client, content());

    expect(result).toEqual({ ok: true, version: 1 });
    expect(insertedRows).toEqual([{ version: 1, content: content(), source: 'edited' }]);
  });

  it('retries once, re-reading the latest version, on a unique-constraint collision', async () => {
    const { client, insertedRows } = fakeSupabaseForSave({
      latestVersions: [2, 3],
      insertErrorCodes: ['23505', null],
    });

    const result = await saveOfferEdit(client, content());

    expect(result).toEqual({ ok: true, version: 4 });
    expect(insertedRows).toEqual([{ version: 4, content: content(), source: 'edited' }]);
  });

  it('gives up with a 409 after a second collision', async () => {
    const { client } = fakeSupabaseForSave({ latestVersions: [2, 3], insertErrorCodes: ['23505', '23505'] });

    const result = await saveOfferEdit(client, content());

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(409);
      expect(result.reason).toMatch(/same time/i);
    }
  });

  it('degrades to a friendly reason when the table is missing', async () => {
    const { client } = fakeSupabaseForSave({ latestVersions: [], readErrorCode: 'PGRST205' });

    const result = await saveOfferEdit(client, content());

    expect(result).toEqual({ ok: false, status: 200, reason: 'Run migration 0014 first.' });
  });

  it('returns 500 on a non-collision insert error', async () => {
    const { client } = fakeSupabaseForSave({ latestVersions: [1], insertErrorCodes: ['other'] });

    const result = await saveOfferEdit(client, content());

    expect(result).toEqual({ ok: false, status: 500, reason: 'Could not save the offer.' });
  });

  it('returns 500 when the read errors for a reason other than a missing table', async () => {
    const { client } = fakeSupabaseForSave({ latestVersions: [], readErrorCode: 'other' });

    const result = await saveOfferEdit(client, content());

    expect(result).toEqual({ ok: false, status: 500, reason: 'Could not load the current offer version.' });
  });
});

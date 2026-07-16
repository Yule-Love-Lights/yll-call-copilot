import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SEEDED_RUBRIC, saveRubricEdit, validateRubricContent } from './rubric';
import type { RubricContent } from './types';

function validRubric(overrides: Partial<RubricContent> = {}): RubricContent {
  return { ...SEEDED_RUBRIC, ...overrides };
}

describe('SEEDED_RUBRIC', () => {
  it('has sales weights summing to 100', () => {
    expect(SEEDED_RUBRIC.sales.reduce((sum, d) => sum + d.weight, 0)).toBe(100);
  });

  it('has hospitality weights summing to 100', () => {
    expect(SEEDED_RUBRIC.hospitality.reduce((sum, d) => sum + d.weight, 0)).toBe(100);
  });

  it('has an overall weighting summing to 1.0', () => {
    const { experience, sales, hospitality } = SEEDED_RUBRIC.weighting;
    expect(experience + sales + hospitality).toBeCloseTo(1.0, 5);
  });

  it('itself passes validateRubricContent', () => {
    expect(validateRubricContent(SEEDED_RUBRIC).valid).toBe(true);
  });
});

describe('validateRubricContent', () => {
  it('rejects sales weights that do not sum to 100', () => {
    const bad = validRubric({
      sales: SEEDED_RUBRIC.sales.map((d, i) => (i === 0 ? { ...d, weight: d.weight + 5 } : d)),
    });
    const result = validateRubricContent(bad);
    expect(result.valid).toBe(false);
  });

  it('rejects hospitality weights that do not sum to 100', () => {
    const bad = validRubric({
      hospitality: SEEDED_RUBRIC.hospitality.map((d, i) => (i === 0 ? { ...d, weight: d.weight - 1 } : d)),
    });
    expect(validateRubricContent(bad).valid).toBe(false);
  });

  it('rejects a weighting that does not sum to 1.0', () => {
    const bad = validRubric({ weighting: { experience: 0.5, sales: 0.35, hospitality: 0.25 } });
    expect(validateRubricContent(bad).valid).toBe(false);
  });

  it('rejects a sales section missing a required dimension key', () => {
    const bad = validRubric({ sales: SEEDED_RUBRIC.sales.filter(d => d.key !== 'close') });
    expect(validateRubricContent(bad).valid).toBe(false);
  });

  it('rejects a hospitality section missing a required dimension key', () => {
    const bad = validRubric({ hospitality: SEEDED_RUBRIC.hospitality.filter(d => d.key !== 'dead_air') });
    expect(validateRubricContent(bad).valid).toBe(false);
  });

  it('rejects a non-object value', () => {
    expect(validateRubricContent(null).valid).toBe(false);
    expect(validateRubricContent('nope').valid).toBe(false);
  });

  it('rejects a dimension with a non-string instructions field', () => {
    const bad = validRubric({
      sales: SEEDED_RUBRIC.sales.map((d, i) => (i === 0 ? { ...d, instructions: 123 as never } : d)),
    });
    expect(validateRubricContent(bad).valid).toBe(false);
  });
});

// Fake client mirrors the pattern in playbook/versions.test.ts — one entry
// per rubric_versions.select call (max version so far), one per insert call.
function fakeSupabase(opts: { maxVersions: number[]; insertErrorCodes?: (string | null)[] }) {
  let selectCallIndex = 0;
  let insertCallIndex = 0;
  const insertedRows: { version: number; content: RubricContent; source: string }[] = [];

  const from = vi.fn((table: string) => {
    if (table !== 'rubric_versions') throw new Error(`Unexpected table in test: ${table}`);
    return {
      select: () => ({
        order: () => ({
          limit: () => ({
            maybeSingle: () => {
              const idx = Math.min(selectCallIndex, opts.maxVersions.length - 1);
              selectCallIndex++;
              const version = opts.maxVersions[idx];
              return Promise.resolve({ data: version > 0 ? { version } : null, error: null });
            },
          }),
        }),
      }),
      insert: (row: { version: number; content: RubricContent; source: string }) => {
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

describe('saveRubricEdit', () => {
  it('rejects bad weights before ever touching the database', async () => {
    const { client, insertedRows } = fakeSupabase({ maxVersions: [1] });
    const bad: RubricContent = { ...SEEDED_RUBRIC, weighting: { experience: 0.5, sales: 0.35, hospitality: 0.25 } };

    const result = await saveRubricEdit(client, bad);

    expect(result).toEqual({ ok: false, status: 400, reason: expect.stringContaining('weighting') });
    expect(insertedRows).toEqual([]);
  });

  it('bumps the version by 1 and saves with source edited on the happy path', async () => {
    const { client, insertedRows } = fakeSupabase({ maxVersions: [3] });

    const result = await saveRubricEdit(client, SEEDED_RUBRIC);

    expect(result).toEqual({ ok: true, version: 4 });
    expect(insertedRows).toEqual([{ version: 4, content: SEEDED_RUBRIC, source: 'edited' }]);
  });

  it('starts at version 1 when the table is empty', async () => {
    const { client, insertedRows } = fakeSupabase({ maxVersions: [0] });

    const result = await saveRubricEdit(client, SEEDED_RUBRIC);

    expect(result).toEqual({ ok: true, version: 1 });
    expect(insertedRows[0].version).toBe(1);
  });

  it('retries once on a version collision, re-reading the fresh max version', async () => {
    const { client, insertedRows } = fakeSupabase({ maxVersions: [3, 4], insertErrorCodes: ['23505', null] });

    const result = await saveRubricEdit(client, SEEDED_RUBRIC);

    expect(result).toEqual({ ok: true, version: 5 });
    expect(insertedRows).toEqual([{ version: 5, content: SEEDED_RUBRIC, source: 'edited' }]);
  });

  it('gives up with 409 after a second collision', async () => {
    const { client } = fakeSupabase({ maxVersions: [3, 4], insertErrorCodes: ['23505', '23505'] });

    const result = await saveRubricEdit(client, SEEDED_RUBRIC);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(409);
      expect(result.reason).toMatch(/same time/i);
    }
  });
});

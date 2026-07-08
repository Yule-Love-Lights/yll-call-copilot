// Coverage for the CSV parser, phone normalization, and header/column
// detection in parse.ts. The fixture files under fixtures/transcripts/
// drive the higher-level parseTranscriptFiles assertions; small inline
// strings cover the CSV parser's escaping rules directly.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { normalizePhone, parseCsv, parseTranscriptFiles } from './parse';

const FIXTURES_DIR = join(process.cwd(), 'fixtures', 'transcripts');

function readFixture(name: string): string {
  return readFileSync(join(FIXTURES_DIR, name), 'utf8');
}

describe('normalizePhone', () => {
  it('strips formatting characters', () => {
    expect(normalizePhone('(555) 231-4488')).toBe('5552314488');
  });

  it('drops a leading US country code', () => {
    expect(normalizePhone('+1 555-231-4488')).toBe('5552314488');
    expect(normalizePhone('1-555-231-4488')).toBe('5552314488');
  });

  it('handles dot-separated numbers', () => {
    expect(normalizePhone('555.231.4488')).toBe('5552314488');
  });

  it('returns null for missing input', () => {
    expect(normalizePhone(null)).toBeNull();
    expect(normalizePhone(undefined)).toBeNull();
    expect(normalizePhone('')).toBeNull();
  });

  it('returns null when there are no digits at all', () => {
    expect(normalizePhone('call me')).toBeNull();
  });

  it('leaves an already-10-digit number untouched', () => {
    expect(normalizePhone('5559981204')).toBe('5559981204');
  });
});

describe('parseCsv', () => {
  it('splits a simple grid', () => {
    expect(parseCsv('a,b\nc,d')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
  });

  it('handles CRLF line endings', () => {
    expect(parseCsv('a,b\r\nc,d')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
  });

  it('keeps a comma inside a quoted field', () => {
    expect(parseCsv('"a,b",c')).toEqual([['a,b', 'c']]);
  });

  it('keeps a newline inside a quoted field', () => {
    expect(parseCsv('"a\nb",c')).toEqual([['a\nb', 'c']]);
  });

  it('unescapes a doubled quote inside a quoted field', () => {
    expect(parseCsv('"say ""hi""",c')).toEqual([['say "hi"', 'c']]);
  });

  it('does not produce a bogus trailing row for a file ending in a newline', () => {
    expect(parseCsv('a,b\n')).toEqual([['a', 'b']]);
  });

  it('parses the messy quoted fixture with embedded commas, quotes, and newlines', () => {
    const rows = parseCsv(readFixture('calls-04-batch.csv'));
    expect(rows).toHaveLength(4); // header + 3 data rows
    expect(rows[0]).toEqual(['Customer Name', 'Phone Number', 'Call Date', 'Transcript']);
    expect(rows[1][0]).toBe('Wanda Cross');
    expect(rows[1][3]).toContain('Rep: Hi Wanda');
    expect(rows[1][3]).toContain('say "yes" today'); // doubled "" resolved to a single "
    expect(rows[1][3].split('\n').length).toBeGreaterThan(1); // the embedded newlines survived
  });
});

describe('parseTranscriptFiles — .txt with a header block', () => {
  it('pulls name/phone/date from a "Name:"/"Phone:"/"Date:" header', () => {
    const [result] = parseTranscriptFiles([
      { name: 'call-01-header-booked.txt', text: readFixture('call-01-header-booked.txt') },
    ]);
    expect(result.customer_name).toBe('Karen Whitfield');
    expect(result.customer_phone).toBe('5552314488');
    // The fixture's header uses ISO date-only format ("2025-11-03"), which
    // the ECMAScript spec guarantees parses as UTC midnight regardless of
    // the machine's local timezone — safe to assert exactly.
    expect(result.called_at).toBe('2025-11-03T00:00:00.000Z');
    expect(result.raw_text).toContain('Rep: Hi Karen');
  });

  it('pulls fields from multi-word header labels ("Customer Name:", "Phone Number:", "Call Date:")', () => {
    const [result] = parseTranscriptFiles([
      { name: 'call-02-header-not-booked.txt', text: readFixture('call-02-header-not-booked.txt') },
    ]);
    expect(result.customer_name).toBe('Alan Prescott');
    expect(result.customer_phone).toBe('5559082214');
    expect(result.called_at).toBe('2025-11-05T00:00:00.000Z');
  });
});

describe('parseTranscriptFiles — bare .txt (no header block)', () => {
  it('tolerates the absence of a header without misreading dialogue as one', () => {
    const [result] = parseTranscriptFiles([{ name: 'call-03-bare.txt', text: readFixture('call-03-bare.txt') }]);
    // The first two lines are "Rep: ..." / "Customer: ..." — neither "rep"
    // nor bare "customer" is a recognized header key, so nothing should
    // get misread out of the dialogue.
    expect(result.customer_name).toBeNull();
    expect(result.customer_phone).toBeNull();
    expect(result.called_at).toBeNull();
    expect(result.raw_text).toContain('Rep: Hi, this is Casey');
  });
});

describe('parseTranscriptFiles — .csv', () => {
  it('produces one transcript per row via fuzzy column detection', () => {
    const results = parseTranscriptFiles([
      { name: 'calls-04-batch.csv', text: readFixture('calls-04-batch.csv') },
    ]);
    expect(results).toHaveLength(3);

    expect(results[0].customer_name).toBe('Wanda Cross');
    expect(results[0].customer_phone).toBe('5556742201'); // from "(555) 674-2201"
    expect(results[0].raw_text).toContain('Rep: Hi Wanda');

    expect(results[1].customer_name).toBe('Marcus Delgado');
    expect(results[1].customer_phone).toBe('5551189932'); // from "555-118-9932"

    expect(results[2].customer_name).toBe('Priya Nandakumar');
    expect(results[2].customer_phone).toBe('5559981204'); // already bare digits
  });

  it('resolves "Customer Phone" style headers to customer_phone, not customer_name', () => {
    const csv = '"Customer Phone","Customer Name","Transcript"\n"555-000-1111","Jamie Lee","hello there"';
    const [result] = parseTranscriptFiles([{ name: 'ambiguous.csv', text: csv }]);
    expect(result.customer_phone).toBe('5550001111');
    expect(result.customer_name).toBe('Jamie Lee');
  });

  it('falls back to a labeled dump of every column when no transcript column is detected', () => {
    const csv = '"Name","Phone"\n"Jamie Lee","555-000-1111"';
    const [result] = parseTranscriptFiles([{ name: 'no-transcript-col.csv', text: csv }]);
    expect(result.raw_text).toContain('Name: Jamie Lee');
    expect(result.raw_text).toContain('Phone: 555-000-1111');
  });

  it('skips fully blank rows', () => {
    const csv = '"Name","Transcript"\n"Jamie Lee","hi"\n"",""';
    const results = parseTranscriptFiles([{ name: 'blank-row.csv', text: csv }]);
    expect(results).toHaveLength(1);
  });
});

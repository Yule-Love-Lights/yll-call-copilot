// Parses uploaded transcript files (.txt and .csv) into rows ready for the
// `transcripts` table. Pure — no I/O, no Supabase, no network — so a bulk
// ingest of up to ~2000 files can run this synchronously before anything
// touches the database or GoHighLevel. .zip files are unzipped by the
// caller (src/app/api/ingest/transcripts/route.ts) into the same
// {name, text} shape before reaching this module.

export type UploadedFile = { name: string; text: string };

export type ParsedTranscript = {
  source_file: string;
  customer_name: string | null;
  customer_phone: string | null;
  called_at: string | null; // ISO string, or null if absent/unparseable
  raw_text: string;
};

// ─── Phone normalization ────────────────────────────────────────────────────
// Strips everything but digits, then drops a US "1" country-code prefix so a
// number always compares equal whether it arrived as "5551234567",
// "(555) 123-4567", or "+1 555-123-4567". Used both to populate
// customer_phone here and to search GHL by phone in outcomes.ts.
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) return digits.slice(1);
  return digits || null;
}

function parseLooseDate(value: string | null): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

// ─── .txt header block ──────────────────────────────────────────────────────
// Deliberately narrow keyword lists: a real transcript body commonly has
// speaker-turn lines like "Rep:" or "Customer:" that also match the
// "Label: value" shape. Bare "customer"/"caller" are left out of
// NAME_KEYS on purpose so a dialogue line never gets misread as a header
// field — only an explicit "Name:" / "Customer Name:" style label counts.
const NAME_KEYS = ['name', 'customer name', 'caller name'];
const PHONE_KEYS = ['phone', 'phone number'];
const DATE_KEYS = ['date', 'call date'];
const HEADER_LINE = /^([A-Za-z][A-Za-z ]{0,24}?):\s*(.+)$/;
const MAX_HEADER_LINES = 8;

type HeaderFields = { customer_name: string | null; customer_phone: string | null; called_at: string | null };

function extractHeaderFields(text: string): HeaderFields {
  const fields: HeaderFields = { customer_name: null, customer_phone: null, called_at: null };
  const lines = text.split(/\r?\n/);

  for (let i = 0; i < lines.length && i < MAX_HEADER_LINES; i++) {
    const line = lines[i].trim();
    if (!line) break; // the header block ends at the first blank line

    const match = line.match(HEADER_LINE);
    if (!match) continue;
    const key = match[1].trim().toLowerCase();
    const value = match[2].trim();
    if (!value) continue;

    if (fields.customer_name === null && NAME_KEYS.includes(key)) fields.customer_name = value;
    else if (fields.customer_phone === null && PHONE_KEYS.includes(key)) fields.customer_phone = value;
    else if (fields.called_at === null && DATE_KEYS.includes(key)) fields.called_at = value;
  }

  return fields;
}

function parseTxtFile(file: UploadedFile): ParsedTranscript {
  const header = extractHeaderFields(file.text);
  return {
    source_file: file.name,
    customer_name: header.customer_name,
    customer_phone: normalizePhone(header.customer_phone),
    called_at: parseLooseDate(header.called_at),
    raw_text: file.text,
  };
}

// ─── Small CSV parser (no dependency) ──────────────────────────────────────
// Handles quoted fields, doubled-quote escapes ("" inside a quoted field),
// and commas/newlines embedded inside quotes. Not a full RFC4180
// implementation (fixed comma delimiter) — just enough for a rep's
// spreadsheet export.
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;

  const pushField = () => {
    row.push(field);
    field = '';
  };
  const pushRow = () => {
    pushField();
    rows.push(row);
    row = [];
  };

  while (i < text.length) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === ',') {
      pushField();
      i++;
      continue;
    }
    if (ch === '\r') {
      if (text[i + 1] === '\n') i++;
      pushRow();
      i++;
      continue;
    }
    if (ch === '\n') {
      pushRow();
      i++;
      continue;
    }
    field += ch;
    i++;
  }
  // Flush a trailing field/row that wasn't terminated by a final newline.
  if (field.length > 0 || row.length > 0) pushRow();

  // A file ending in a newline otherwise leaves one bogus all-empty row.
  return rows.filter(r => !(r.length === 1 && r[0] === ''));
}

// ─── CSV column detection ───────────────────────────────────────────────────
type ColumnTarget = 'raw_text' | 'customer_name' | 'customer_phone' | 'called_at';

// Order matters: a header like "Customer Phone" contains both "customer"
// (a customer_name keyword) and "phone" (a customer_phone keyword). Checking
// the narrower fields first resolves it to customer_phone; customer_name is
// the catch-all, checked last.
const COLUMN_KEYWORDS: { target: ColumnTarget; keywords: string[] }[] = [
  { target: 'customer_phone', keywords: ['phone', 'number', 'tel'] },
  { target: 'called_at', keywords: ['date', 'time', 'called'] },
  { target: 'raw_text', keywords: ['transcript', 'text', 'body', 'conversation'] },
  { target: 'customer_name', keywords: ['name', 'customer', 'contact'] },
];

function detectColumn(header: string): ColumnTarget | null {
  const h = header.toLowerCase().trim();
  for (const { target, keywords } of COLUMN_KEYWORDS) {
    if (keywords.some(k => h.includes(k))) return target;
  }
  return null;
}

function parseCsvFile(file: UploadedFile): ParsedTranscript[] {
  const rows = parseCsv(file.text);
  if (rows.length === 0) return [];

  const [headerRow, ...dataRows] = rows;
  const columns = headerRow.map(detectColumn);
  const rawTextIndex = columns.indexOf('raw_text');

  return dataRows
    .filter(r => r.some(cell => cell.trim() !== ''))
    .map((cells): ParsedTranscript => {
      let customer_name: string | null = null;
      let customer_phone: string | null = null;
      let called_at: string | null = null;

      columns.forEach((target, idx) => {
        const value = (cells[idx] ?? '').trim();
        if (!value || !target) return;
        if (target === 'customer_name' && customer_name === null) customer_name = value;
        else if (target === 'customer_phone' && customer_phone === null) customer_phone = value;
        else if (target === 'called_at' && called_at === null) called_at = value;
      });

      // No detected transcript column: fall back to every cell (labeled by
      // its header) so a row never reaches the database with an empty
      // raw_text (the column is NOT NULL) and no data is silently dropped.
      const raw_text =
        rawTextIndex >= 0
          ? (cells[rawTextIndex] ?? '').trim()
          : cells.map((cell, idx) => `${headerRow[idx] ?? `col${idx}`}: ${cell}`).join('\n');

      return {
        source_file: file.name,
        customer_name,
        customer_phone: normalizePhone(customer_phone),
        called_at: parseLooseDate(called_at),
        raw_text: raw_text || '(empty row)',
      };
    });
}

export function parseTranscriptFiles(files: UploadedFile[]): ParsedTranscript[] {
  const out: ParsedTranscript[] = [];
  for (const file of files) {
    if (file.name.toLowerCase().endsWith('.csv')) {
      out.push(...parseCsvFile(file));
    } else {
      // .txt is the only other type the API route accepts.
      out.push(parseTxtFile(file));
    }
  }
  return out;
}

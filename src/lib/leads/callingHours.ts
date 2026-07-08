// TCPA calling-hours gate: 8am-9pm in the CONTACT's local time, not the
// server's and not necessarily the company's. Pure date math via the Intl
// API (no new deps) -- Intl.DateTimeFormat with a `timeZone` option reads
// the correct wall-clock hour for that zone directly, DST included, with no
// manual UTC-offset arithmetic to get wrong.

// The company's own zone -- used only when a contact has no timezone on
// file (GHL sometimes doesn't have one) or an unrecognized zone string comes
// back, never as a substitute for a contact's REAL zone when one is known.
export const COMPANY_TIMEZONE = 'America/New_York';

const CALLING_HOURS_START = 8; // 8am, inclusive
const CALLING_HOURS_END = 21; // 9pm, exclusive

function localHour(timeZone: string, now: Date): number {
  const formatter = new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', hour12: false });
  // Some ICU builds format midnight as "24" rather than "00" -- normalize
  // either way to 0-23.
  return Number(formatter.format(now)) % 24;
}

export function isWithinCallingHours(contactTimezone: string | null | undefined, now: Date): boolean {
  let hour: number;
  try {
    hour = localHour(contactTimezone || COMPANY_TIMEZONE, now);
  } catch {
    // An invalid/unrecognized IANA zone (bad GHL data) falls back to the
    // company's own zone rather than throwing or silently allowing every
    // hour through.
    hour = localHour(COMPANY_TIMEZONE, now);
  }
  return hour >= CALLING_HOURS_START && hour < CALLING_HOURS_END;
}

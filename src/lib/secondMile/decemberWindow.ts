// The December 10-25 cookies+ornament window, and the "season year" used to
// build yearly dedupe keys (cookies_ornament, cold_snap_checkin) -- both read
// the wall-clock date in the company's own zone via Intl.DateTimeFormat, same
// approach as src/lib/leads/callingHours.ts (DST-correct, no manual UTC-offset
// arithmetic).

import { COMPANY_TIMEZONE } from '../leads/callingHours';

const WINDOW_START_DAY = 10; // December 10, inclusive
const WINDOW_END_DAY = 25; // December 25, inclusive

function localDateParts(timeZone: string, now: Date): { year: number; month: number; day: number } {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  });
  const parts = formatter.formatToParts(now);
  const get = (type: string) => Number(parts.find(p => p.type === type)?.value);
  return { year: get('year'), month: get('month'), day: get('day') };
}

export function isWithinCookiesOrnamentWindow(now: Date, timeZone: string = COMPANY_TIMEZONE): boolean {
  const { month, day } = localDateParts(timeZone, now);
  return month === 12 && day >= WINDOW_START_DAY && day <= WINDOW_END_DAY;
}

// The calendar year (in the company's zone) at this instant -- used for the
// `${kind}:${ghl_contact_id}:${yyyy}` yearly dedupe keys so a touch created
// this season never re-fires next year under the same key.
export function getSeasonYear(now: Date, timeZone: string = COMPANY_TIMEZONE): number {
  return localDateParts(timeZone, now).year;
}

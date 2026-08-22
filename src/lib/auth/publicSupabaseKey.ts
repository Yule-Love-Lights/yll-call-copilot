import { isBrowserSafeSupabaseKey as sharedIsBrowserSafeSupabaseKey } from './publicSupabaseConfig.mjs';

export function isBrowserSafeSupabaseKey(value: string | null | undefined): boolean {
  return sharedIsBrowserSafeSupabaseKey(value);
}

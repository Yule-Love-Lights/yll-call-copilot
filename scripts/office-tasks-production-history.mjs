import { CANONICAL } from './reconcile-0020-0024-hosted-history.mjs';

// These are the exact Supabase history records created by the separately
// approved production identity rollout. They intentionally differ from the
// checked-in source filenames, so a general `supabase db push` remains unsafe.
const PRODUCTION_IDENTITY_HISTORY = Object.freeze([
  Object.freeze({ version: '20260825130719', name: 'quote_tool_identity_bridge' }),
  Object.freeze({ version: '20260825130728', name: 'production_quote_tool_identity_activation' }),
]);

const OFFICE_TASKS_PREREQUISITE_HISTORY = Object.freeze([
  ...CANONICAL,
  ...PRODUCTION_IDENTITY_HISTORY,
]);

export { OFFICE_TASKS_PREREQUISITE_HISTORY, PRODUCTION_IDENTITY_HISTORY };

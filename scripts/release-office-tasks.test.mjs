import { describe, expect, it } from 'vitest';
import { CANONICAL } from './reconcile-0020-0024-hosted-history.mjs';
import {
  OFFICE_TASKS_HISTORY,
  assertOnlyDeferredIdentityMigration,
  classifyOfficeTasksRelease,
} from './release-office-tasks.mjs';

describe('Office Tasks release state machine', () => {
  it('permits only the reviewed start and recovery states', () => {
    expect(classifyOfficeTasksRelease(CANONICAL, 'absent')).toBe('apply-and-record');
    expect(classifyOfficeTasksRelease(CANONICAL, 'present')).toBe('record-only');
    expect(classifyOfficeTasksRelease([...CANONICAL, OFFICE_TASKS_HISTORY], 'present')).toBe('already-released');
    expect(() => classifyOfficeTasksRelease([...CANONICAL, OFFICE_TASKS_HISTORY], 'absent')).toThrow(/reviewed/);
    expect(() => classifyOfficeTasksRelease(CANONICAL, 'partial')).toThrow(/reviewed/);
  });

  it('requires the post-release dry run to contain only deferred 0025', () => {
    expect(() => assertOnlyDeferredIdentityMigration('Would push 0025_quote_tool_identity_bridge.sql')).not.toThrow();
    expect(() => assertOnlyDeferredIdentityMigration('Would push 0025_quote_tool_identity_bridge.sql\nWould push 20260821141530_office_tasks.sql')).toThrow(/only deferred/);
  });
});

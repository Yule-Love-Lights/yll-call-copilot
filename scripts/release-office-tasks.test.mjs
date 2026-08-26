import { describe, expect, it, vi } from 'vitest';
import { OFFICE_TASKS_PREREQUISITE_HISTORY } from './office-tasks-production-history.mjs';
import {
  OFFICE_TASKS_HISTORY,
  assertExpectedSourceIdentityMigrations,
  assertOfficeTasksPostconditions,
  classifyOfficeTasksRelease,
  readHistory,
  readSchemaState,
} from './release-office-tasks.mjs';

describe('Office Tasks release state machine', () => {
  it('permits only the reviewed start and recovery states', () => {
    expect(classifyOfficeTasksRelease(OFFICE_TASKS_PREREQUISITE_HISTORY, 'absent')).toBe('apply-and-record');
    expect(classifyOfficeTasksRelease(OFFICE_TASKS_PREREQUISITE_HISTORY, 'present')).toBe('record-only');
    expect(classifyOfficeTasksRelease([...OFFICE_TASKS_PREREQUISITE_HISTORY, OFFICE_TASKS_HISTORY], 'present')).toBe('already-released');
    expect(() => classifyOfficeTasksRelease(OFFICE_TASKS_PREREQUISITE_HISTORY.slice(0, -2), 'absent')).toThrow(/reviewed/);
    expect(() => classifyOfficeTasksRelease([...OFFICE_TASKS_PREREQUISITE_HISTORY, OFFICE_TASKS_HISTORY], 'absent')).toThrow(/reviewed/);
    expect(() => classifyOfficeTasksRelease(OFFICE_TASKS_PREREQUISITE_HISTORY, 'partial')).toThrow(/reviewed/);
  });

  it('requires the post-release dry run to report only known source identity migrations', () => {
    expect(() => assertExpectedSourceIdentityMigrations('Would push 0025_quote_tool_identity_bridge.sql\nWould push 20260825120136_production_quote_tool_identity_activation.sql')).not.toThrow();
    expect(() => assertExpectedSourceIdentityMigrations('Would push 0025_quote_tool_identity_bridge.sql\nWould push 20260821141530_office_tasks.sql')).toThrow(/only the known/);
  });

  it('reads migration history without psql transaction status lines', () => {
    const runner = {
      psql: vi.fn(() => OFFICE_TASKS_PREREQUISITE_HISTORY
        .map(({ version, name }) => `${version}\t${name}`).join('\n')),
    };

    expect(readHistory(runner)).toEqual(OFFICE_TASKS_PREREQUISITE_HISTORY);
    expect(runner.psql).toHaveBeenCalledWith(expect.not.stringMatching(/\b(?:begin|commit)\b/i));
  });

  it('reads the schema state without psql transaction status lines', () => {
    const runner = { psql: vi.fn(() => 'absent\n') };

    expect(readSchemaState(runner)).toBe('absent');
    expect(runner.psql).toHaveBeenCalledWith(expect.not.stringMatching(/\b(?:begin|commit)\b/i));
  });

  it('checks postconditions without psql transaction status lines', () => {
    const runner = { psql: vi.fn(() => 'YLL_OFFICE_TASKS_OK\n') };

    expect(() => assertOfficeTasksPostconditions(runner)).not.toThrow();
    expect(runner.psql).toHaveBeenCalledWith(expect.not.stringMatching(/\b(?:begin|commit)\b/i));
  });
});

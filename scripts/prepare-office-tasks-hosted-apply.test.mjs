import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import {
  OFFICE_TASKS_FILENAME,
  OFFICE_TASKS_SHA256,
  OFFICE_TASKS_VERSION,
  PREREQUISITE_HISTORY_VALUES,
  assertGeneratedOfficeTasksDriver,
  buildOfficeTasksDriver,
  readExactOfficeTasksMigration,
} from './prepare-office-tasks-hosted-apply.mjs';

const directory = mkdtempSync(join(tmpdir(), 'yll-office-tasks-driver-'));
afterAll(() => rmSync(directory, { recursive: true, force: true }));

describe('Office Tasks hosted apply driver', () => {
  it('embeds only the reviewed migration under an atomic preflight and postcondition', () => {
    const driver = buildOfficeTasksDriver();
    expect(driver).toContain(`BEGIN canonical migration ${OFFICE_TASKS_VERSION}: ${OFFICE_TASKS_FILENAME}`);
    expect(OFFICE_TASKS_SHA256).toMatch(/^[0-9a-f]{64}$/);
    expect(driver).toContain('Office Tasks migration history is not in the reviewed pre-apply state');
    expect(PREREQUISITE_HISTORY_VALUES).toContain("('20260825130719', 'quote_tool_identity_bridge')");
    expect(PREREQUISITE_HISTORY_VALUES).toContain("('20260825130728', 'production_quote_tool_identity_activation')");
    expect(driver).toContain('Office Tasks schema is not absent before apply');
    expect(driver).toContain('Office Tasks postcondition failed');
    expect(driver).toMatch(/^\\set ON_ERROR_STOP on[\s\S]*begin;[\s\S]*commit;\n$/);
    expect(() => assertGeneratedOfficeTasksDriver(driver)).not.toThrow();
  });

  it('rejects any changed byte', () => {
    expect(() => assertGeneratedOfficeTasksDriver(`${buildOfficeTasksDriver()}-- changed\n`)).toThrow(/exact generated/);
  });

  it('refuses an unreviewed migration file', () => {
    const path = join(directory, 'changed.sql');
    writeFileSync(path, 'select 1;\n');
    expect(() => readExactOfficeTasksMigration(path)).toThrow(/SHA-256/);
    expect(createHash('sha256').update(readExactOfficeTasksMigration()).digest('hex')).toBe(OFFICE_TASKS_SHA256);
  });
});

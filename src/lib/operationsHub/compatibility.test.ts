import { describe, expect, it } from 'vitest';
import contractPin from '../../../docs/operations-hub/contract-pin.json';
import schemaManifest from '../../../docs/operations-hub/ops-contract-schema/manifest.json';
import {
  assessOperationsCompatibility,
  gateOperationsValue,
  HUB_SUPPORTED_OPERATIONS_VERSIONS,
} from './compatibility';

const currentVersions = {
  contract_version: schemaManifest.contract_version,
  schema_version: schemaManifest.schema_version,
  client_version: 'quote-tool-test-build',
};

describe('Operations contract compatibility', () => {
  it('derives the exact positive allowlist from the pinned schema manifest', () => {
    expect(HUB_SUPPORTED_OPERATIONS_VERSIONS).toEqual({
      contractVersions: [contractPin.contract_version],
      schemaVersions: [contractPin.schema_version],
    });
  });

  it('accepts the exact contract/schema pair and preserves diagnostic fields', () => {
    expect(assessOperationsCompatibility({ ...currentVersions, ignored: true })).toEqual({
      status: 'compatible',
      versions: currentVersions,
    });
  });

  it.each([undefined, null])('treats %s as missing version health', (input) => {
    expect(assessOperationsCompatibility(input)).toEqual({
      status: 'unavailable',
      reason: 'missing',
    });
  });

  it.each([
    'not-an-object',
    [],
    1,
    { contract_version: currentVersions.contract_version },
    { ...currentVersions, contract_version: '' },
    { ...currentVersions, schema_version: '1.0' },
    { ...currentVersions, client_version: '   ' },
    { ...currentVersions, client_version: 7 },
  ])('rejects malformed or partial version health %#', (input) => {
    const result = assessOperationsCompatibility(input);
    expect(result.status).toBe('unavailable');
  });

  it('reports an unsupported contract version', () => {
    expect(assessOperationsCompatibility({
      ...currentVersions,
      contract_version: '2.0.0',
    })).toEqual({
      status: 'incompatible',
      errorCodes: ['contract_version_unsupported'],
      versions: { ...currentVersions, contract_version: '2.0.0' },
    });
  });

  it('reports an unsupported schema version', () => {
    expect(assessOperationsCompatibility({
      ...currentVersions,
      schema_version: '2.0.0',
    })).toEqual({
      status: 'incompatible',
      errorCodes: ['schema_version_unsupported'],
      versions: { ...currentVersions, schema_version: '2.0.0' },
    });
  });

  it('reports both version mismatches without widening compatibility', () => {
    const result = assessOperationsCompatibility({
      ...currentVersions,
      contract_version: '2.0.0',
      schema_version: '3.0.0-draft',
    });
    expect(result.status).toBe('incompatible');
    if (result.status !== 'incompatible') throw new Error('expected incompatibility');
    expect(result.errorCodes).toEqual([
      'contract_version_unsupported',
      'schema_version_unsupported',
    ]);
  });

  it('returns values only when the compatibility check succeeds', () => {
    const value = { quote_id: 'quote-1' };
    const compatible = assessOperationsCompatibility(currentVersions);
    expect(gateOperationsValue(compatible, value)).toEqual({
      status: 'available',
      value,
      versions: currentVersions,
    });

    const unavailable = gateOperationsValue(
      assessOperationsCompatibility(undefined),
      value,
    );
    expect(unavailable).toEqual({
      status: 'unavailable',
      reason: 'version_health_unavailable',
    });
    expect('value' in unavailable).toBe(false);

    const incompatible = gateOperationsValue(
      assessOperationsCompatibility({ ...currentVersions, contract_version: '2.0.0' }),
      value,
    );
    expect(incompatible).toEqual({
      status: 'unavailable',
      reason: 'contract_version_unsupported',
    });
    expect('value' in incompatible).toBe(false);
  });
});

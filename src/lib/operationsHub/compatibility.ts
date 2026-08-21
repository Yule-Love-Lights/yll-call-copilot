import schemaManifest from '../../../docs/operations-hub/ops-contract-schema/manifest.json';

const semanticVersionPattern = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

export const HUB_SUPPORTED_OPERATIONS_VERSIONS = Object.freeze({
  contractVersions: Object.freeze([schemaManifest.contract_version]),
  schemaVersions: Object.freeze([schemaManifest.schema_version]),
});

export type OperationsVersionSurface = Readonly<{
  contract_version: string;
  schema_version: string;
  client_version: string;
}>;

export type OperationsVersionErrorCode =
  | 'contract_version_unsupported'
  | 'schema_version_unsupported';

export type OperationsCompatibility =
  | Readonly<{
      status: 'compatible';
      versions: OperationsVersionSurface;
    }>
  | Readonly<{
      status: 'unavailable';
      reason: 'missing' | 'malformed';
    }>
  | Readonly<{
      status: 'incompatible';
      errorCodes: readonly OperationsVersionErrorCode[];
      versions: OperationsVersionSurface;
    }>;

export type OperationsValueGate<T> =
  | Readonly<{
      status: 'available';
      value: T;
      versions: OperationsVersionSurface;
    }>
  | Readonly<{
      status: 'unavailable';
      reason:
        | 'version_health_unavailable'
        | 'contract_version_unsupported'
        | 'schema_version_unsupported';
    }>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function assessOperationsCompatibility(input: unknown): OperationsCompatibility {
  if (input === null || input === undefined) {
    return { status: 'unavailable', reason: 'missing' };
  }
  if (!isRecord(input)) {
    return { status: 'unavailable', reason: 'malformed' };
  }

  const contractVersion = input.contract_version;
  const schemaVersion = input.schema_version;
  const clientVersion = input.client_version;
  if (
    contractVersion === null
    || contractVersion === undefined
    || schemaVersion === null
    || schemaVersion === undefined
    || clientVersion === null
    || clientVersion === undefined
  ) {
    return { status: 'unavailable', reason: 'missing' };
  }
  if (
    typeof contractVersion !== 'string'
    || typeof schemaVersion !== 'string'
    || typeof clientVersion !== 'string'
  ) {
    return { status: 'unavailable', reason: 'malformed' };
  }

  const versions: OperationsVersionSurface = {
    contract_version: contractVersion,
    schema_version: schemaVersion,
    client_version: clientVersion,
  };
  if (
    !semanticVersionPattern.test(versions.contract_version)
    || !semanticVersionPattern.test(versions.schema_version)
    || versions.client_version.trim().length === 0
  ) {
    return { status: 'unavailable', reason: 'malformed' };
  }

  const errorCodes: OperationsVersionErrorCode[] = [];
  if (!HUB_SUPPORTED_OPERATIONS_VERSIONS.contractVersions.includes(versions.contract_version)) {
    errorCodes.push('contract_version_unsupported');
  }
  if (!HUB_SUPPORTED_OPERATIONS_VERSIONS.schemaVersions.includes(versions.schema_version)) {
    errorCodes.push('schema_version_unsupported');
  }

  if (errorCodes.length > 0) {
    return { status: 'incompatible', errorCodes, versions };
  }
  return { status: 'compatible', versions };
}

export function gateOperationsValue<T>(
  compatibility: OperationsCompatibility,
  value: T,
): OperationsValueGate<T> {
  if (compatibility.status === 'compatible') {
    return { status: 'available', value, versions: compatibility.versions };
  }
  if (compatibility.status === 'unavailable') {
    return { status: 'unavailable', reason: 'version_health_unavailable' };
  }
  if (compatibility.errorCodes.includes('contract_version_unsupported')) {
    return { status: 'unavailable', reason: 'contract_version_unsupported' };
  }
  return { status: 'unavailable', reason: 'schema_version_unsupported' };
}

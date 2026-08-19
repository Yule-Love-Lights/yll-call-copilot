#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { lstat, readFile, realpath, stat } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const maximumContractBytes = 1024 * 1024;
const defaultPinPath = resolve(
  repositoryRoot,
  'docs/operations-hub/contract-pin.json',
);

function parseArguments(argv) {
  const parsed = {
    pinPath: defaultPinPath,
    mirrorPath: undefined,
    canonicalPath: process.env.OPS_HUB_CANONICAL_CONTRACT_PATH
      ? resolve(process.env.OPS_HUB_CANONICAL_CONTRACT_PATH)
      : undefined,
    requireCanonical: false,
  };
  const suppliedValueArguments = new Set();

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--require-canonical') {
      parsed.requireCanonical = true;
      continue;
    }
    if (argument === '--help') {
      parsed.help = true;
      continue;
    }
    if (argument === '--pin' || argument === '--mirror' || argument === '--canonical') {
      if (suppliedValueArguments.has(argument)) {
        throw new Error(`${argument} may be supplied only once`);
      }
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) {
        throw new Error(`${argument} requires a file path`);
      }
      suppliedValueArguments.add(argument);
      index += 1;
      if (argument === '--pin') parsed.pinPath = resolve(value);
      if (argument === '--mirror') parsed.mirrorPath = value;
      if (argument === '--canonical') parsed.canonicalPath = resolve(value);
      continue;
    }
    throw new Error(`unknown argument: ${argument}`);
  }

  return parsed;
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function assertPin(pin) {
  if (!pin || typeof pin !== 'object' || Array.isArray(pin)) {
    throw new Error('contract pin must be a JSON object');
  }
  const allowedKeys = [
    'manifest_version',
    'contract_version',
    'schema_version',
    'canonical_repository',
    'canonical_path',
    'canonical_commit',
    'mirror_path',
    'sha256',
    'byte_length',
    'artifacts',
  ];
  const unknownKeys = Object.keys(pin).filter((key) => !allowedKeys.includes(key));
  if (unknownKeys.length > 0) {
    throw new Error(`contract pin has unknown key(s): ${unknownKeys.sort().join(', ')}`);
  }
  if (pin.manifest_version !== 2) {
    throw new Error('contract pin has unsupported manifest_version');
  }
  const requiredStrings = [
    'contract_version',
    'schema_version',
    'canonical_repository',
    'canonical_path',
    'canonical_commit',
    'mirror_path',
    'sha256',
  ];
  for (const key of requiredStrings) {
    if (typeof pin[key] !== 'string' || pin[key].length === 0) {
      throw new Error(`contract pin has no valid ${key}`);
    }
  }
  if (!Number.isInteger(pin.byte_length) || pin.byte_length < 1) {
    throw new Error('contract pin has no valid byte_length');
  }
  if (!/^[a-f0-9]{64}$/.test(pin.sha256)) {
    throw new Error('contract pin has no valid SHA-256 value');
  }
  for (const key of ['contract_version', 'schema_version']) {
    if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(pin[key])) {
      throw new Error(`contract pin has no valid semantic ${key}`);
    }
  }
  if (!/^[a-f0-9]{40}$/.test(pin.canonical_commit)) {
    throw new Error('contract pin has no valid canonical_commit');
  }
  if (
    pin.canonical_repository !== 'Yule-Love-Lights/yll-quote-tool'
    || pin.canonical_path !== 'docs/context/OPERATIONS_HUB_CONTRACT.md'
    || pin.mirror_path !== 'docs/operations-hub/INTEGRATION-CONTRACT.md'
  ) {
    throw new Error('contract pin repository and contract paths do not match the approved layout');
  }
  assertRepositoryRelativePath(pin.mirror_path, 'mirror_path');
  assertRepositoryRelativePath(pin.canonical_path, 'canonical_path');

  if (!Array.isArray(pin.artifacts) || pin.artifacts.length !== 3) {
    throw new Error('contract pin must contain exactly three schema artifacts');
  }
  const expectedArtifactNames = new Set(['manifest', 'openapi', 'json_schema']);
  const expectedArtifactLayout = {
    manifest: {
      canonicalPath: 'docs/context/ops-contract-schema/manifest.json',
      mirrorPath: 'docs/operations-hub/ops-contract-schema/manifest.json',
    },
    openapi: {
      canonicalPath: 'docs/context/ops-contract-schema/common.openapi.json',
      mirrorPath: 'docs/operations-hub/ops-contract-schema/common.openapi.json',
    },
    json_schema: {
      canonicalPath: 'docs/context/ops-contract-schema/common.schema.json',
      mirrorPath: 'docs/operations-hub/ops-contract-schema/common.schema.json',
    },
  };
  const seenArtifactNames = new Set();
  const seenMirrorPaths = new Set();
  const seenCanonicalPaths = new Set();
  for (const artifact of pin.artifacts) {
    if (!artifact || typeof artifact !== 'object' || Array.isArray(artifact)) {
      throw new Error('contract pin artifact must be a JSON object');
    }
    const allowedArtifactKeys = [
      'name',
      'canonical_path',
      'mirror_path',
      'sha256',
      'byte_length',
    ];
    const unknownArtifactKeys = Object.keys(artifact).filter(
      (key) => !allowedArtifactKeys.includes(key),
    );
    if (unknownArtifactKeys.length > 0) {
      throw new Error(
        `contract pin artifact has unknown key(s): ${unknownArtifactKeys.sort().join(', ')}`,
      );
    }
    if (!expectedArtifactNames.has(artifact.name) || seenArtifactNames.has(artifact.name)) {
      throw new Error('contract pin artifact names must be manifest, openapi, and json_schema');
    }
    if (
      artifact.canonical_path !== expectedArtifactLayout[artifact.name].canonicalPath
      || artifact.mirror_path !== expectedArtifactLayout[artifact.name].mirrorPath
    ) {
      throw new Error(`contract pin artifact ${artifact.name} does not match the approved layout`);
    }
    seenArtifactNames.add(artifact.name);
    for (const key of ['canonical_path', 'mirror_path', 'sha256']) {
      if (typeof artifact[key] !== 'string' || artifact[key].length === 0) {
        throw new Error(`contract pin artifact ${artifact.name} has no valid ${key}`);
      }
    }
    if (!/^[a-f0-9]{64}$/.test(artifact.sha256)) {
      throw new Error(`contract pin artifact ${artifact.name} has no valid SHA-256 value`);
    }
    if (!Number.isInteger(artifact.byte_length) || artifact.byte_length < 1) {
      throw new Error(`contract pin artifact ${artifact.name} has no valid byte_length`);
    }
    assertRepositoryRelativePath(
      artifact.canonical_path,
      `artifact ${artifact.name} canonical_path`,
    );
    assertRepositoryRelativePath(
      artifact.mirror_path,
      `artifact ${artifact.name} mirror_path`,
    );
    if (
      seenCanonicalPaths.has(artifact.canonical_path)
      || seenMirrorPaths.has(artifact.mirror_path)
    ) {
      throw new Error('contract pin artifact paths must be unique');
    }
    seenCanonicalPaths.add(artifact.canonical_path);
    seenMirrorPaths.add(artifact.mirror_path);
  }
}

function assertRepositoryRelativePath(path, label) {
  if (isAbsolute(path)) {
    throw new Error(`contract pin ${label} must be repository-relative`);
  }
  const resolvedPath = resolve(repositoryRoot, path);
  const pathFromRoot = relative(repositoryRoot, resolvedPath);
  if (pathFromRoot === '..' || pathFromRoot.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`)) {
    throw new Error(`contract pin ${label} must stay inside its repository`);
  }
  return resolvedPath;
}

async function readRegularBytes(path, label) {
  try {
    const metadata = await lstat(path);
    if (metadata.isSymbolicLink() || !metadata.isFile()) {
      throw new Error('path is not a regular, non-symbolic-link file');
    }
    if (metadata.size > maximumContractBytes) {
      throw new Error(`file exceeds ${maximumContractBytes} bytes`);
    }
    return await readFile(path);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`cannot read ${label} at ${path}: ${detail}`);
  }
}

function parseJsonBytes(bytes, label) {
  try {
    return JSON.parse(bytes.toString('utf8'));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`${label} is not valid JSON: ${detail}`);
  }
}

async function assertIndependentFiles(firstPath, secondPath, label) {
  const [firstRealPath, secondRealPath] = await Promise.all([
    realpath(firstPath),
    realpath(secondPath),
  ]);
  const [firstMetadata, secondMetadata] = await Promise.all([
    stat(firstRealPath),
    stat(secondRealPath),
  ]);
  if (
    firstRealPath === secondRealPath
    || (firstMetadata.dev === secondMetadata.dev && firstMetadata.ino === secondMetadata.ino)
  ) {
    throw new Error(`${label} canonical path must be an independent file, not the Hub mirror`);
  }
}

async function verify(options) {
  const pinBytes = await readRegularBytes(options.pinPath, 'contract pin');
  let pin;
  try {
    pin = JSON.parse(pinBytes.toString('utf8'));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`contract pin is not valid JSON: ${detail}`);
  }
  assertPin(pin);

  const mirrorPath = options.mirrorPath
    ? assertRepositoryRelativePath(options.mirrorPath, '--mirror')
    : assertRepositoryRelativePath(pin.mirror_path, 'mirror_path');
  const mirrorBytes = await readRegularBytes(mirrorPath, 'Hub contract mirror');
  const mirrorHash = sha256(mirrorBytes);

  if (mirrorBytes.length !== pin.byte_length) {
    throw new Error(
      `Hub mirror byte length ${mirrorBytes.length} does not match pin ${pin.byte_length}`,
    );
  }
  if (mirrorHash !== pin.sha256) {
    throw new Error(`Hub mirror SHA-256 ${mirrorHash} does not match pin ${pin.sha256}`);
  }

  const expectedHeading = `# Operations Hub <-> Quote Tool contract, v${pin.contract_version}`;
  let mirrorText;
  try {
    mirrorText = new TextDecoder('utf-8', { fatal: true }).decode(mirrorBytes);
  } catch {
    throw new Error('Hub mirror is not valid UTF-8');
  }
  const firstLine = mirrorText.split(/\r?\n/, 1)[0];
  if (firstLine !== expectedHeading) {
    throw new Error(
      `Hub mirror heading ${JSON.stringify(firstLine)} does not match ${JSON.stringify(expectedHeading)}`,
    );
  }

  const artifactResults = [];
  for (const artifact of pin.artifacts) {
    const artifactMirrorPath = assertRepositoryRelativePath(
      artifact.mirror_path,
      `artifact ${artifact.name} mirror_path`,
    );
    const artifactBytes = await readRegularBytes(
      artifactMirrorPath,
      `Hub ${artifact.name} mirror`,
    );
    const artifactHash = sha256(artifactBytes);
    if (artifactBytes.length !== artifact.byte_length) {
      throw new Error(
        `Hub ${artifact.name} byte length ${artifactBytes.length} does not match pin ${artifact.byte_length}`,
      );
    }
    if (artifactHash !== artifact.sha256) {
      throw new Error(
        `Hub ${artifact.name} SHA-256 ${artifactHash} does not match pin ${artifact.sha256}`,
      );
    }
    artifactResults.push({ ...artifact, mirrorPath: artifactMirrorPath, bytes: artifactBytes });
  }

  const schemaManifest = parseJsonBytes(
    artifactResults.find((artifact) => artifact.name === 'manifest').bytes,
    'Hub schema manifest',
  );
  const openApi = parseJsonBytes(
    artifactResults.find((artifact) => artifact.name === 'openapi').bytes,
    'Hub OpenAPI artifact',
  );
  const jsonSchema = parseJsonBytes(
    artifactResults.find((artifact) => artifact.name === 'json_schema').bytes,
    'Hub JSON Schema artifact',
  );
  if (
    schemaManifest.contract_version !== pin.contract_version
    || schemaManifest.schema_version !== pin.schema_version
    || schemaManifest.openapi_file !== 'common.openapi.json'
    || schemaManifest.json_schema_file !== 'common.schema.json'
    || schemaManifest.canonical_contract !== '../OPERATIONS_HUB_CONTRACT.md'
  ) {
    throw new Error('Hub schema manifest does not match the pinned contract/schema versions and layout');
  }
  if (
    openApi.openapi !== '3.1.0'
    || openApi.info?.version !== pin.schema_version
    || jsonSchema.schema_version !== pin.schema_version
    || jsonSchema.contract_version !== pin.contract_version
  ) {
    throw new Error('Hub OpenAPI/JSON Schema versions do not match the contract pin');
  }

  if (options.requireCanonical && !options.canonicalPath) {
    throw new Error(
      'cross-repository verification requires OPS_HUB_CANONICAL_CONTRACT_PATH or --canonical',
    );
  }

  if (options.canonicalPath) {
    await assertIndependentFiles(mirrorPath, options.canonicalPath, 'contract');

    const canonicalBytes = await readRegularBytes(
      options.canonicalPath,
      'Quote Tool canonical contract',
    );
    const canonicalHash = sha256(canonicalBytes);
    if (canonicalBytes.length !== pin.byte_length) {
      throw new Error(
        `canonical byte length ${canonicalBytes.length} does not match pin ${pin.byte_length}`,
      );
    }
    if (canonicalHash !== pin.sha256) {
      throw new Error(
        `canonical SHA-256 ${canonicalHash} does not match pin ${pin.sha256}`,
      );
    }
    if (!canonicalBytes.equals(mirrorBytes)) {
      throw new Error('canonical contract and Hub mirror are not byte-identical');
    }
    let canonicalText;
    try {
      canonicalText = new TextDecoder('utf-8', { fatal: true }).decode(canonicalBytes);
    } catch {
      throw new Error('canonical contract is not valid UTF-8');
    }
    if (canonicalText.split(/\r?\n/, 1)[0] !== expectedHeading) {
      throw new Error('canonical contract heading does not match the pinned version');
    }

    const canonicalContractDirectory = dirname(options.canonicalPath);
    const pinnedCanonicalDirectory = dirname(pin.canonical_path);
    for (const artifact of artifactResults) {
      const relativeArtifactPath = relative(
        pinnedCanonicalDirectory,
        artifact.canonical_path,
      );
      if (
        relativeArtifactPath === '..'
        || relativeArtifactPath.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`)
      ) {
        throw new Error(`artifact ${artifact.name} canonical path must stay beside the contract`);
      }
      const canonicalArtifactPath = resolve(canonicalContractDirectory, relativeArtifactPath);
      await assertIndependentFiles(
        artifact.mirrorPath,
        canonicalArtifactPath,
        artifact.name,
      );
      const canonicalArtifactBytes = await readRegularBytes(
        canonicalArtifactPath,
        `Quote Tool canonical ${artifact.name}`,
      );
      if (canonicalArtifactBytes.length !== artifact.byte_length) {
        throw new Error(
          `canonical ${artifact.name} byte length ${canonicalArtifactBytes.length} does not match pin ${artifact.byte_length}`,
        );
      }
      const canonicalArtifactHash = sha256(canonicalArtifactBytes);
      if (canonicalArtifactHash !== artifact.sha256) {
        throw new Error(
          `canonical ${artifact.name} SHA-256 ${canonicalArtifactHash} does not match pin ${artifact.sha256}`,
        );
      }
      if (!canonicalArtifactBytes.equals(artifact.bytes)) {
        throw new Error(`canonical ${artifact.name} and Hub mirror are not byte-identical`);
      }
    }
  }

  return {
    version: pin.contract_version,
    schemaVersion: pin.schema_version,
    sha256: mirrorHash,
    byteLength: mirrorBytes.length,
    artifactCount: artifactResults.length,
    mirrorPath,
    canonicalPath: options.canonicalPath,
  };
}

function printHelp() {
  console.log(`Usage: node scripts/verify-operations-contract.mjs [options]

Options:
  --pin PATH            Use a different contract pin manifest.
  --mirror PATH         Use a different Hub mirror file.
  --canonical PATH      Compare against this canonical Quote Tool contract and
                        its sibling ops-contract-schema artifacts.
  --require-canonical   Fail unless --canonical or
                        OPS_HUB_CANONICAL_CONTRACT_PATH is set.
  --help                Show this help.`);
}

try {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    printHelp();
  } else {
    const result = await verify(options);
    console.log(
      `LOCAL_PIN_OK contract_version=${result.version} ${result.byteLength} bytes SHA-256 ${result.sha256}`,
    );
    console.log(
      `LOCAL_ARTIFACTS_OK schema_version=${result.schemaVersion} files=${result.artifactCount}`,
    );
    if (result.canonicalPath) {
      console.log(
        `CROSS_REPO_BYTES_OK contract and ${result.artifactCount} schema artifacts are byte-identical`,
      );
    }
  }
} catch (error) {
  const detail = error instanceof Error ? error.message : String(error);
  console.error(`Operations contract verification failed: ${detail}`);
  process.exitCode = 1;
}

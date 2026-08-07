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
    'canonical_repository',
    'canonical_path',
    'canonical_commit',
    'mirror_path',
    'sha256',
    'byte_length',
  ];
  const unknownKeys = Object.keys(pin).filter((key) => !allowedKeys.includes(key));
  if (unknownKeys.length > 0) {
    throw new Error(`contract pin has unknown key(s): ${unknownKeys.sort().join(', ')}`);
  }
  if (pin.manifest_version !== 1) {
    throw new Error('contract pin has unsupported manifest_version');
  }
  const requiredStrings = [
    'contract_version',
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
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(pin.contract_version)) {
    throw new Error('contract pin has no valid semantic contract_version');
  }
  if (!/^[a-f0-9]{40}$/.test(pin.canonical_commit)) {
    throw new Error('contract pin has no valid canonical_commit');
  }
  assertRepositoryRelativePath(pin.mirror_path, 'mirror_path');
  assertRepositoryRelativePath(pin.canonical_path, 'canonical_path');
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

  if (options.requireCanonical && !options.canonicalPath) {
    throw new Error(
      'cross-repository verification requires OPS_HUB_CANONICAL_CONTRACT_PATH or --canonical',
    );
  }

  if (options.canonicalPath) {
    const [mirrorRealPath, canonicalRealPath] = await Promise.all([
      realpath(mirrorPath),
      realpath(options.canonicalPath),
    ]);
    const [mirrorMetadata, canonicalMetadata] = await Promise.all([
      stat(mirrorRealPath),
      stat(canonicalRealPath),
    ]);
    if (
      mirrorRealPath === canonicalRealPath ||
      (mirrorMetadata.dev === canonicalMetadata.dev && mirrorMetadata.ino === canonicalMetadata.ino)
    ) {
      throw new Error('canonical path must be an independent file, not the Hub mirror');
    }

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
  }

  return {
    version: pin.contract_version,
    sha256: mirrorHash,
    byteLength: mirrorBytes.length,
    mirrorPath,
    canonicalPath: options.canonicalPath,
  };
}

function printHelp() {
  console.log(`Usage: node scripts/verify-operations-contract.mjs [options]

Options:
  --pin PATH            Use a different contract pin manifest.
  --mirror PATH         Use a different Hub mirror file.
  --canonical PATH      Compare against this canonical Quote Tool file.
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
    if (result.canonicalPath) {
      console.log('CROSS_REPO_BYTES_OK canonical and Hub mirror are byte-identical');
    }
  }
} catch (error) {
  const detail = error instanceof Error ? error.message : String(error);
  console.error(`Operations contract verification failed: ${detail}`);
  process.exitCode = 1;
}

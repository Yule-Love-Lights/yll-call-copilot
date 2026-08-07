import { execFileSync, spawnSync } from 'node:child_process';
import {
  copyFileSync,
  linkSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repositoryRoot = fileURLToPath(new URL('../../..', import.meta.url));
const verifierPath = resolve(repositoryRoot, 'scripts/verify-operations-contract.mjs');
const mirrorPath = resolve(
  repositoryRoot,
  'docs/operations-hub/INTEGRATION-CONTRACT.md',
);
const pinPath = resolve(repositoryRoot, 'docs/operations-hub/contract-pin.json');

function cleanEnvironment() {
  const environment = { ...process.env };
  delete environment.OPS_HUB_CANONICAL_CONTRACT_PATH;
  return environment;
}

function withTemporaryDirectory<T>(parent: string, run: (path: string) => T): T {
  const temporaryDirectory = mkdtempSync(resolve(parent, '.ops-contract-test-'));
  try {
    return run(temporaryDirectory);
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

describe('Operations Hub contract verifier', () => {
  it('accepts the checked-in pinned mirror', () => {
    const output = execFileSync(process.execPath, [verifierPath], {
      cwd: repositoryRoot,
      encoding: 'utf8',
      env: cleanEnvironment(),
    });

    expect(output).toContain('LOCAL_PIN_OK contract_version=1.3.0-draft 41336 bytes');
  });

  it('accepts an independent exact canonical byte copy from another cwd', () => {
    withTemporaryDirectory(resolve(tmpdir()), (temporaryDirectory) => {
      const workingDirectory = resolve(temporaryDirectory, 'path with spaces');
      const canonicalPath = resolve(temporaryDirectory, 'canonical contract.md');
      mkdirSync(workingDirectory);
      copyFileSync(mirrorPath, canonicalPath);

      const environment = cleanEnvironment();
      environment.OPS_HUB_CANONICAL_CONTRACT_PATH = canonicalPath;
      const output = execFileSync(process.execPath, [verifierPath, '--require-canonical'], {
        cwd: workingDirectory,
        encoding: 'utf8',
        env: environment,
      });

      expect(output).toContain('CROSS_REPO_BYTES_OK');
    });
  });

  it('rejects a same-length byte mutation in the mirror', () => {
    withTemporaryDirectory(repositoryRoot, (temporaryDirectory) => {
      const modifiedMirror = resolve(temporaryDirectory, 'mirror.md');
      const modifiedBytes = Buffer.from(readFileSync(mirrorPath));
      modifiedBytes[modifiedBytes.length - 2] ^= 1;
      writeFileSync(modifiedMirror, modifiedBytes);

      const result = spawnSync(
        process.execPath,
        [
          verifierPath,
          '--pin',
          pinPath,
          '--mirror',
          relative(repositoryRoot, modifiedMirror),
        ],
        {
          cwd: repositoryRoot,
          encoding: 'utf8',
          env: cleanEnvironment(),
        },
      );

      expect(result.status).toBe(1);
      expect(result.stderr).toContain('Hub mirror SHA-256');
    });
  });

  it('fails closed when cross-repository verification has no canonical path', () => {
    const result = spawnSync(process.execPath, [verifierPath, '--require-canonical'], {
      cwd: repositoryRoot,
      encoding: 'utf8',
      env: cleanEnvironment(),
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('requires OPS_HUB_CANONICAL_CONTRACT_PATH');
  });

  it('rejects a canonical path that is the mirror or a hardlink to it', () => {
    const sameFile = spawnSync(
      process.execPath,
      [verifierPath, '--canonical', mirrorPath],
      { cwd: repositoryRoot, encoding: 'utf8', env: cleanEnvironment() },
    );
    expect(sameFile.status).toBe(1);
    expect(sameFile.stderr).toContain('independent file');

    withTemporaryDirectory(resolve(tmpdir()), (temporaryDirectory) => {
      const hardlinkPath = resolve(temporaryDirectory, 'canonical.md');
      linkSync(mirrorPath, hardlinkPath);
      const hardlink = spawnSync(
        process.execPath,
        [verifierPath, '--canonical', hardlinkPath],
        { cwd: repositoryRoot, encoding: 'utf8', env: cleanEnvironment() },
      );
      expect(hardlink.status).toBe(1);
      expect(hardlink.stderr).toContain('independent file');
    });
  });

  it('rejects a same-length canonical mutation while the local mirror stays valid', () => {
    withTemporaryDirectory(resolve(tmpdir()), (temporaryDirectory) => {
      const canonicalPath = resolve(temporaryDirectory, 'canonical.md');
      const modifiedBytes = Buffer.from(readFileSync(mirrorPath));
      modifiedBytes[modifiedBytes.length - 2] ^= 1;
      writeFileSync(canonicalPath, modifiedBytes);
      const result = spawnSync(
        process.execPath,
        [verifierPath, '--canonical', canonicalPath],
        { cwd: repositoryRoot, encoding: 'utf8', env: cleanEnvironment() },
      );
      expect(result.status).toBe(1);
      expect(result.stderr).toContain('canonical SHA-256');
    });
  });

  it('rejects mirror symlinks and paths outside the repository', () => {
    withTemporaryDirectory(repositoryRoot, (temporaryDirectory) => {
      const symlinkPath = resolve(temporaryDirectory, 'mirror-link.md');
      symlinkSync(mirrorPath, symlinkPath);
      const symlinkResult = spawnSync(
        process.execPath,
        [verifierPath, '--mirror', relative(repositoryRoot, symlinkPath)],
        { cwd: repositoryRoot, encoding: 'utf8', env: cleanEnvironment() },
      );
      expect(symlinkResult.status).toBe(1);
      expect(symlinkResult.stderr).toContain('non-symbolic-link file');
    });

    const traversalResult = spawnSync(
      process.execPath,
      [verifierPath, '--mirror', '../quote/docs/context/OPERATIONS_HUB_CONTRACT.md'],
      { cwd: repositoryRoot, encoding: 'utf8', env: cleanEnvironment() },
    );
    expect(traversalResult.status).toBe(1);
    expect(traversalResult.stderr).toContain('must stay inside its repository');
  });

  it('rejects unknown or malformed manifest fields', () => {
    withTemporaryDirectory(resolve(tmpdir()), (temporaryDirectory) => {
      const validPin = JSON.parse(readFileSync(pinPath, 'utf8')) as Record<string, unknown>;
      const cases: Array<[string, Record<string, unknown>, string]> = [
        ['unknown', { ...validPin, unreviewed_field: true }, 'unknown key'],
        ['version', { ...validPin, contract_version: 'v1.3.0-draft' }, 'semantic contract_version'],
        ['hash', { ...validPin, sha256: 'not-a-hash' }, 'SHA-256'],
        ['length', { ...validPin, byte_length: 0 }, 'byte_length'],
      ];

      for (const [name, pin, expectedError] of cases) {
        const invalidPinPath = resolve(temporaryDirectory, `${name}.json`);
        writeFileSync(invalidPinPath, JSON.stringify(pin));
        const result = spawnSync(
          process.execPath,
          [verifierPath, '--pin', invalidPinPath],
          { cwd: repositoryRoot, encoding: 'utf8', env: cleanEnvironment() },
        );
        expect(result.status).toBe(1);
        expect(result.stderr).toContain(expectedError);
      }
    });
  });

  it('rejects duplicate CLI arguments', () => {
    const duplicateArgument = spawnSync(
      process.execPath,
      [verifierPath, '--canonical', 'one', '--canonical', 'two'],
      { cwd: repositoryRoot, encoding: 'utf8', env: cleanEnvironment() },
    );
    expect(duplicateArgument.status).toBe(1);
    expect(duplicateArgument.stderr).toContain('may be supplied only once');
  });
});

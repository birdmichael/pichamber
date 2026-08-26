import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  assertPiNodeKernelLayout,
  findPackagedResourceRoots,
  packagedNodeBinaryRelative,
  verifyPackagedPiNodeKernel,
} from './verify-pi-node-kernel.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const electronRoot = path.resolve(__dirname, '..');

const writeFile = (filePath, contents = 'ok\n') => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents);
};

const fixtureApp = ({
  root,
  withNode = true,
  withChild = true,
  withStagedChild = false,
  platform = 'darwin',
} = {}) => {
  const resourcesPath = path.join(root, 'Pichamber.app', 'Contents', 'Resources');
  if (withNode) {
    writeFile(path.join(resourcesPath, packagedNodeBinaryRelative(platform)), '#!/bin/sh\nexit 0\n');
    fs.chmodSync(path.join(resourcesPath, packagedNodeBinaryRelative(platform)), 0o755);
  }
  if (withChild) {
    writeFile(path.join(
      resourcesPath,
      'app.asar.unpacked',
      'node_modules',
      '@pichamber',
      'web',
      'server',
      'lib',
      'pi',
      'node-kernel-child.js',
    ), 'export {}\n');
  }
  if (withStagedChild) {
    writeFile(path.join(resourcesPath, 'pi-node-kernel', 'node-kernel-child.js'), 'export {}\n');
  }
  return resourcesPath;
};

test('asarUnpack keeps the Pi server and SDK readable by a real Node', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(electronRoot, 'package.json'), 'utf8'));
  assert.deepEqual(pkg.build.asarUnpack, [
    '**/node_modules/@pichamber/web/server/**',
    '**/node_modules/@earendil-works/**',
  ]);
});

test('assertPiNodeKernelLayout requires bundled Node and the unpacked child, not pi-node-kernel', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-kernel-verify-'));
  try {
    const resourcesPath = fixtureApp({ root });
    const layout = assertPiNodeKernelLayout({ resourcesPath, platform: 'darwin' });
    assert.match(layout.nodeBinary, /node[/\\]bin[/\\]node$/);
    assert.match(layout.unpackedChild, /app\.asar\.unpacked.*node-kernel-child\.js$/);
    assert.equal(fs.existsSync(path.join(resourcesPath, 'pi-node-kernel')), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('assertPiNodeKernelLayout fails when the bundled Node is missing', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-kernel-verify-'));
  try {
    const resourcesPath = fixtureApp({ root, withNode: false });
    assert.throws(
      () => assertPiNodeKernelLayout({ resourcesPath, platform: 'darwin' }),
      /missing the bundled Node binary/,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('assertPiNodeKernelLayout fails when only a staged pi-node-kernel child exists', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-kernel-verify-'));
  try {
    const resourcesPath = fixtureApp({
      root,
      withChild: false,
      withStagedChild: true,
    });
    assert.throws(
      () => assertPiNodeKernelLayout({ resourcesPath, platform: 'darwin' }),
      /missing the unpacked Pi node kernel child/,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('verifyPackagedPiNodeKernel finds a macOS .app Resources tree', () => {
  const distDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-kernel-dist-'));
  try {
    const resourcesPath = fixtureApp({ root: distDir });
    const roots = findPackagedResourceRoots(distDir);
    assert.deepEqual(roots, [resourcesPath]);
    const verified = verifyPackagedPiNodeKernel({
      distDir,
      platform: 'darwin',
      probeSdk: false,
    });
    assert.equal(verified.length, 1);
    assert.equal(verified[0].resourcesPath, resourcesPath);
  } finally {
    fs.rmSync(distDir, { recursive: true, force: true });
  }
});

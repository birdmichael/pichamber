import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  collectProductionPackageNames,
  extractPackageFromAsar,
} from './unpack-node-kernel-deps.cjs';

const writeJson = (filePath, value) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
};

test('collectProductionPackageNames walks unpacked and asar package.json trees', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-kernel-deps-'));
  try {
    const resourcesPath = path.join(root, 'Resources');
    writeJson(path.join(
      resourcesPath,
      'app.asar.unpacked',
      'node_modules',
      '@earendil-works',
      'pi-coding-agent',
      'package.json',
    ), {
      name: '@earendil-works/pi-coding-agent',
      dependencies: { chalk: '5.6.2', yaml: '2.8.1' },
    });
    const asarFiles = {
      'node_modules/chalk/package.json': JSON.stringify({
        name: 'chalk',
        dependencies: { 'ansi-styles': '6.0.0' },
      }),
      'node_modules/ansi-styles/package.json': JSON.stringify({
        name: 'ansi-styles',
        dependencies: {},
      }),
      'node_modules/yaml/package.json': JSON.stringify({
        name: 'yaml',
        dependencies: {},
      }),
    };
    const names = collectProductionPackageNames({
      resourcesPath,
      asarPath: path.join(resourcesPath, 'app.asar'),
      asarApi: {
        extractFile: (_archive, filePath) => {
          const key = String(filePath).replace(/^\//, '');
          if (!asarFiles[key]) throw new Error(`missing ${key}`);
          return Buffer.from(asarFiles[key]);
        },
      },
    });
    assert.deepEqual(names, [
      '@earendil-works/pi-coding-agent',
      'ansi-styles',
      'chalk',
      'yaml',
    ]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('extractPackageFromAsar writes missing packages next to the unpacked kernel', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-kernel-extract-'));
  try {
    const unpackedRoot = path.join(root, 'app.asar.unpacked');
    fs.mkdirSync(unpackedRoot, { recursive: true });
    const asarFiles = {
      'node_modules/chalk/package.json': '{"name":"chalk"}\n',
      'node_modules/chalk/source/index.js': 'export default {}\n',
    };
    const written = extractPackageFromAsar({
      asarApi: {
        listPackage: () => Object.keys(asarFiles),
        extractFile: (_archive, filePath) => {
          const key = String(filePath).replace(/^\//, '');
          if (!asarFiles[key]) throw new Error(`missing ${key}`);
          return Buffer.from(asarFiles[key]);
        },
      },
      asarPath: path.join(root, 'app.asar'),
      packageName: 'chalk',
      unpackedRoot,
    });
    assert.equal(written, 2);
    assert.equal(
      fs.readFileSync(path.join(unpackedRoot, 'node_modules', 'chalk', 'package.json'), 'utf8'),
      '{"name":"chalk"}\n',
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

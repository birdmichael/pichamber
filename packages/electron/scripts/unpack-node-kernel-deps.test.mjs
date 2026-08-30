import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  collectProductionPackageNames,
  extractPackageFromAsar,
  normalizeAsarPath,
  stagePackagedNodeKernelDeps,
} from './unpack-node-kernel-deps.cjs';

const writeJson = (filePath, value) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
};

const writeFile = (filePath, contents) => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents);
};

const mockAsar = (asarFiles) => ({
  listPackage: () => Object.keys(asarFiles),
  extractFile: (_archive, filePath) => {
    const key = String(filePath);
    if (asarFiles[key]) return Buffer.from(asarFiles[key]);
    const normalized = String(filePath).replace(/\\/g, '/').replace(/^\//, '');
    if (asarFiles[normalized]) return Buffer.from(asarFiles[normalized]);
    const backslash = normalized.replace(/\//g, '\\');
    if (asarFiles[backslash]) return Buffer.from(asarFiles[backslash]);
    throw new Error(`missing ${key}`);
  },
});

test('normalizeAsarPath converts backslashes and strips a leading slash', () => {
  assert.equal(normalizeAsarPath('node_modules\\chalk\\package.json'), 'node_modules/chalk/package.json');
  assert.equal(normalizeAsarPath('/node_modules/chalk/package.json'), 'node_modules/chalk/package.json');
});

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

test('collectProductionPackageNames finds nested backslash asar package.json via listing', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-kernel-nested-collect-'));
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
      'node_modules\\@earendil-works\\pi-coding-agent\\node_modules\\chalk\\package.json': JSON.stringify({
        name: 'chalk',
        dependencies: { 'ansi-styles': '6.0.0' },
      }),
      'node_modules\\ansi-styles\\package.json': JSON.stringify({
        name: 'ansi-styles',
        dependencies: {},
      }),
      'node_modules\\yaml\\package.json': JSON.stringify({
        name: 'yaml',
        dependencies: {},
      }),
    };
    const names = collectProductionPackageNames({
      resourcesPath,
      asarPath: path.join(resourcesPath, 'app.asar'),
      asarApi: mockAsar(asarFiles),
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
      asarApi: mockAsar(asarFiles),
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

test('extractPackageFromAsar hoists Windows backslash asar paths to unpacked chalk', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-kernel-backslash-'));
  try {
    const unpackedRoot = path.join(root, 'app.asar.unpacked');
    fs.mkdirSync(unpackedRoot, { recursive: true });
    const asarFiles = {
      'node_modules\\chalk\\package.json': '{"name":"chalk"}\n',
      'node_modules\\chalk\\source\\index.js': 'export default {}\n',
      'node_modules\\chalk-parser\\package.json': '{"name":"chalk-parser"}\n',
    };
    const written = extractPackageFromAsar({
      asarApi: mockAsar(asarFiles),
      asarPath: path.join(root, 'app.asar'),
      packageName: 'chalk',
      unpackedRoot,
    });
    assert.equal(written, 2);
    assert.equal(
      fs.readFileSync(path.join(unpackedRoot, 'node_modules', 'chalk', 'package.json'), 'utf8'),
      '{"name":"chalk"}\n',
    );
    assert.equal(fs.existsSync(path.join(unpackedRoot, 'node_modules', 'chalk-parser')), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('extractPackageFromAsar hoists nested chalk onto top-level unpacked node_modules', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-kernel-nested-extract-'));
  try {
    const unpackedRoot = path.join(root, 'app.asar.unpacked');
    fs.mkdirSync(unpackedRoot, { recursive: true });
    const asarFiles = {
      'node_modules/@earendil-works/pi-coding-agent/node_modules/chalk/package.json': '{"name":"chalk"}\n',
      'node_modules/@earendil-works/pi-coding-agent/node_modules/chalk/index.js': 'export default {}\n',
    };
    const written = extractPackageFromAsar({
      asarApi: mockAsar(asarFiles),
      asarPath: path.join(root, 'app.asar'),
      packageName: 'chalk',
      unpackedRoot,
    });
    assert.equal(written, 2);
    assert.equal(
      fs.readFileSync(path.join(unpackedRoot, 'node_modules', 'chalk', 'package.json'), 'utf8'),
      '{"name":"chalk"}\n',
    );
    assert.equal(
      fs.existsSync(path.join(
        unpackedRoot,
        'node_modules',
        '@earendil-works',
        'pi-coding-agent',
        'node_modules',
        'chalk',
      )),
      false,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

const fixtureResources = (root) => {
  const resourcesPath = path.join(root, 'Resources');
  writeFile(path.join(resourcesPath, 'app.asar'), 'asar\n');
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
  writeJson(path.join(
    resourcesPath,
    'app.asar.unpacked',
    'node_modules',
    'yaml',
    'package.json',
  ), {
    name: 'yaml',
    dependencies: {},
  });
  return resourcesPath;
};

test('stagePackagedNodeKernelDeps copies a missing package from searchRoots with dereference', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-kernel-stage-copy-'));
  try {
    const resourcesPath = fixtureResources(root);
    const realChalk = path.join(root, 'real-chalk');
    writeJson(path.join(realChalk, 'package.json'), {
      name: 'chalk',
      dependencies: { 'ansi-styles': '6.0.0' },
    });
    writeFile(path.join(realChalk, 'index.js'), 'export default {}\n');
    writeFile(path.join(realChalk, 'node_modules', 'nested-should-not-copy', 'package.json'), '{"name":"nested"}\n');

    const realAnsi = path.join(root, 'real-ansi-styles');
    writeJson(path.join(realAnsi, 'package.json'), { name: 'ansi-styles', dependencies: {} });
    writeFile(path.join(realAnsi, 'index.js'), 'export default {}\n');

    const searchRoot = path.join(root, 'install');
    fs.mkdirSync(path.join(searchRoot, 'node_modules'), { recursive: true });
    fs.symlinkSync(realChalk, path.join(searchRoot, 'node_modules', 'chalk'));
    fs.symlinkSync(realAnsi, path.join(searchRoot, 'node_modules', 'ansi-styles'));

    const result = stagePackagedNodeKernelDeps({
      resourcesPath,
      requireAsar: () => mockAsar({}),
      searchRoots: [searchRoot],
    });

    const unpackedChalk = path.join(resourcesPath, 'app.asar.unpacked', 'node_modules', 'chalk');
    const unpackedAnsi = path.join(resourcesPath, 'app.asar.unpacked', 'node_modules', 'ansi-styles');
    assert.equal(fs.lstatSync(unpackedChalk).isSymbolicLink(), false);
    assert.equal(fs.readFileSync(path.join(unpackedChalk, 'index.js'), 'utf8'), 'export default {}\n');
    assert.equal(fs.existsSync(path.join(unpackedChalk, 'node_modules')), false);
    assert.equal(fs.existsSync(path.join(unpackedAnsi, 'package.json')), true);
    assert.ok(result.staged.includes('chalk'));
    assert.ok(result.staged.includes('ansi-styles'));
    assert.deepEqual(result.names, [
      '@earendil-works/pi-coding-agent',
      'ansi-styles',
      'chalk',
      'yaml',
    ]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('stagePackagedNodeKernelDeps throws when a collected dep cannot be extracted or copied', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-kernel-stage-throw-'));
  try {
    const resourcesPath = fixtureResources(root);
    assert.throws(
      () => stagePackagedNodeKernelDeps({
        resourcesPath,
        requireAsar: () => mockAsar({}),
        searchRoots: [],
      }),
      /Failed to unpack Pi kernel Node deps.*chalk/,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

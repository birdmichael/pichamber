import assert from 'node:assert/strict';
import test from 'node:test';

import { RELEASE_VERSION_PACKAGE_PATHS, assertReleasePackageVersions } from './assert-release-package-versions.mjs';

test('accepts matching workspace package versions', () => {
  const files = Object.fromEntries(RELEASE_VERSION_PACKAGE_PATHS.map((filePath) => [filePath, '{"version":"1.2.3"}']));
  assert.doesNotThrow(() => assertReleasePackageVersions('1.2.3', {
    root: '/repo',
    readFile: (filePath) => files[filePath.replace('/repo/', '')],
  }));
});

test('rejects a drifted package version and a placeholder release version', () => {
  const files = Object.fromEntries(RELEASE_VERSION_PACKAGE_PATHS.map((filePath) => [filePath, '{"version":"1.2.3"}']));
  files['packages/electron/package.json'] = '{"version":"1.2.2"}';
  assert.throws(
    () => assertReleasePackageVersions('1.2.3', {
      root: '/repo',
      readFile: (filePath) => files[filePath.replace('/repo/', '')],
    }),
    /packages\/electron\/package.json is 1.2.2/,
  );
  assert.throws(() => assertReleasePackageVersions('0.0.0-dev'), /concrete release version/);
});

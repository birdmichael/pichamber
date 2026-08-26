import assert from 'node:assert/strict';
import test from 'node:test';

import { isNodeBinary, isPublicNodeReleaseVersion, isRelocatableNodeBinary, officialNodeFileKey, pickOfficialNodeReleases, probeNodeLoadsPiSdk } from './prepare-node.mjs';

test('officialNodeFileKey matches nodejs.org index names', () => {
  assert.equal(officialNodeFileKey({ platform: 'darwin', arch: 'arm64' }), 'osx-arm64-tar');
  assert.equal(officialNodeFileKey({ platform: 'win32', arch: 'x64' }), 'win-x64-zip');
  assert.equal(officialNodeFileKey({ platform: 'linux', arch: 'x64' }), 'linux-x64');
});

test('pickOfficialNodeReleases prefers LTS then current without hardcoding versions', () => {
  const releases = pickOfficialNodeReleases([
    { version: 'v24.5.0', lts: false, files: ['linux-x64', 'osx-arm64-tar'] },
    { version: 'v22.18.0', lts: 'Jod', files: ['linux-x64', 'osx-arm64-tar'] },
    { version: 'v20.19.2', lts: 'Iron', files: ['linux-x64'] },
  ], { platform: 'linux', arch: 'x64' });
  assert.equal(releases[0].version, 'v22.18.0');
  assert.equal(releases[0].lts, true);
  assert.equal(releases.some((item) => item.version === 'v24.5.0'), true);
  assert.match(releases[0].url, /^https:\/\/nodejs\.org\/dist\/v22\.18\.0\//);
});

test('pickOfficialNodeReleases finds official macOS arm64 tarballs', () => {
  const releases = pickOfficialNodeReleases([
    { version: 'v24.20.0', lts: 'Krypton', files: ['osx-arm64-tar', 'linux-arm64'] },
  ], { platform: 'darwin', arch: 'arm64' });
  assert.equal(releases[0].version, 'v24.20.0');
  assert.equal(releases[0].name, 'node-v24.20.0-darwin-arm64.tar.gz');
});

test('probeNodeLoadsPiSdk fails closed when the binary cannot import the SDK', () => {
  const probed = probeNodeLoadsPiSdk({
    command: process.execPath,
    spawnImpl: () => ({ status: 2, stderr: 'webidl.util.markAsUncloneable is not a function' }),
  });
  assert.equal(probed.ok, false);
  assert.match(probed.error, /markAsUncloneable/);
});

test('isNodeBinary rejects PATH pi', () => {
  assert.equal(isNodeBinary('/usr/bin/node'), true);
  assert.equal(isNodeBinary('/usr/local/bin/pi'), false);
});

test('isPublicNodeReleaseVersion rejects unofficial leftover Node strings', () => {
  assert.equal(isPublicNodeReleaseVersion('v26.8.0'), true);
  assert.equal(isPublicNodeReleaseVersion('v26.8.0-alpha.0.0.0'), false);
  assert.equal(isPublicNodeReleaseVersion('v26.8.0-nightly20260826'), false);
  assert.equal(isPublicNodeReleaseVersion(''), false);
});

test('isRelocatableNodeBinary rejects Homebrew-linked Node stubs', () => {
  const relocatable = isRelocatableNodeBinary({
    libraries: [
      '/opt/homebrew/Cellar/node/25.9.0_3/bin/node:',
      '@rpath/libnode.141.dylib (compatibility version 0.0.0)',
      '/opt/homebrew/opt/openssl@3/lib/libcrypto.3.dylib',
    ],
  });
  assert.equal(relocatable.ok, false);
  assert.match(relocatable.error, /libnode\.141\.dylib/);
});

test('isRelocatableNodeBinary accepts a standalone official Node', () => {
  const relocatable = isRelocatableNodeBinary({
    libraries: [
      '/tmp/node-v22.18.0-darwin-arm64/bin/node:',
      '/usr/lib/libSystem.B.dylib (compatibility version 1.0.0)',
      '/usr/lib/libc++.1.dylib (compatibility version 1.0.0)',
    ],
  });
  assert.equal(relocatable.ok, true);
});

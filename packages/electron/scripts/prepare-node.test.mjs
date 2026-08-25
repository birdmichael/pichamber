import assert from 'node:assert/strict';
import test from 'node:test';

import { isNodeBinary, pickOfficialNodeReleases, probeNodeLoadsPiSdk } from './prepare-node.mjs';

test('pickOfficialNodeReleases prefers current then LTS without hardcoding versions', () => {
  const releases = pickOfficialNodeReleases([
    { version: 'v24.5.0', lts: false, files: ['linux-x64', 'darwin-arm64'] },
    { version: 'v22.18.0', lts: 'Jod', files: ['linux-x64', 'darwin-arm64'] },
    { version: 'v20.19.2', lts: 'Iron', files: ['linux-x64'] },
  ], { platform: 'linux', arch: 'x64' });
  assert.equal(releases[0].version, 'v24.5.0');
  assert.equal(releases.some((item) => item.version === 'v22.18.0' && item.lts), true);
  assert.match(releases[0].url, /^https:\/\/nodejs\.org\/dist\/v24\.5\.0\//);
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

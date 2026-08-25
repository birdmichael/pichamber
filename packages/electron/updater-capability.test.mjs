import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertUpdaterCapability,
  canInstallDesktopUpdateInPlace,
  describeInPlaceInstallFailure,
  inspectMacAppCodeSign,
  parseMacCodeSignOutput,
  resolveDesktopReleaseUrl,
} from './updater-capability.mjs';

test('preserves updater behavior outside packaged Linux', () => {
  assert.doesNotThrow(() => assertUpdaterCapability({ platform: 'darwin', packaged: true }));
  assert.doesNotThrow(() => assertUpdaterCapability({ platform: 'win32', packaged: true }));
  assert.doesNotThrow(() => assertUpdaterCapability({ platform: 'linux', packaged: false }));
});

test('rejects packaged Linux execution outside an AppImage', () => {
  assert.throws(
    () => assertUpdaterCapability({ platform: 'linux', packaged: true, appImagePath: '' }),
    /Start Pichamber from its \.AppImage file/,
  );
});

test('rejects missing and non-writable AppImages with actionable errors', () => {
  assert.throws(
    () => assertUpdaterCapability({
      platform: 'linux',
      packaged: true,
      appImagePath: '/opt/OpenChamber.AppImage',
      stat: () => { throw new Error('missing'); },
    }),
    /cannot be found.*valid \.AppImage file/,
  );
  assert.throws(
    () => assertUpdaterCapability({
      platform: 'linux',
      packaged: true,
      appImagePath: '/opt/OpenChamber.AppImage',
      stat: () => ({ isFile: () => true }),
      access: () => { throw new Error('read-only'); },
    }),
    /not writable.*grant write permission/,
  );
});

test('accepts a writable packaged AppImage', () => {
  assert.doesNotThrow(() => assertUpdaterCapability({
    platform: 'linux',
    packaged: true,
    appImagePath: '/home/user/OpenChamber.AppImage',
    stat: () => ({ isFile: () => true }),
    access: () => {},
  }));
});

test('treats unsigned and ad-hoc Mac builds as unable to install in-place', () => {
  assert.equal(canInstallDesktopUpdateInPlace({
    platform: 'darwin',
    packaged: true,
    macCodeSign: { signed: false, adhoc: false },
  }), false);
  assert.equal(canInstallDesktopUpdateInPlace({
    platform: 'darwin',
    packaged: true,
    macCodeSign: { signed: true, adhoc: true, identity: null },
  }), false);
  assert.equal(canInstallDesktopUpdateInPlace({
    platform: 'darwin',
    packaged: true,
    macCodeSign: { signed: true, adhoc: false, identity: 'Developer ID Application: Example (TEAM)' },
  }), true);
  assert.equal(canInstallDesktopUpdateInPlace({
    platform: 'darwin',
    packaged: true,
    macCodeSign: { signed: true, adhoc: false, identity: 'Apple Development: Example (TEAM)' },
  }), false);
  assert.equal(canInstallDesktopUpdateInPlace({
    platform: 'darwin',
    packaged: true,
    macCodeSign: { signed: true, adhoc: false, identity: 'Apple Distribution: Example (TEAM)' },
  }), false);
  assert.equal(canInstallDesktopUpdateInPlace({
    platform: 'darwin',
    packaged: true,
    macCodeSign: { signed: true, adhoc: false },
  }), false);
  assert.equal(canInstallDesktopUpdateInPlace({
    platform: 'darwin',
    packaged: false,
    macCodeSign: { signed: true, adhoc: false, identity: 'Developer ID Application: Example (TEAM)' },
  }), false);
  assert.equal(canInstallDesktopUpdateInPlace({ platform: 'linux', packaged: true }), true);
});

test('parses codesign output for unsigned, ad-hoc, and Developer ID apps', () => {
  assert.deepEqual(
    parseMacCodeSignOutput('/Applications/Pichamber.app: code object is not signed at all'),
    { signed: false, adhoc: false, identity: null },
  );
  assert.equal(parseMacCodeSignOutput('CodeDirectory v=20400 flags=0x2(adhoc)\nSignature=adhoc').adhoc, true);
  assert.equal(parseMacCodeSignOutput('CodeDirectory v=20400 flags=0x2(adhoc)\nSignature=adhoc').signed, true);
  const developerId = parseMacCodeSignOutput([
    'CodeDirectory v=20500 flags=0x10000(runtime)',
    'Authority=Developer ID Application: Example (TEAMID)',
    'Authority=Developer ID Certification Authority',
  ].join('\n'));
  assert.equal(developerId.signed, true);
  assert.equal(developerId.adhoc, false);
  assert.match(developerId.identity, /Developer ID Application/);
});

test('inspects a Mac app bundle through an injected codesign spawn', () => {
  const inspected = inspectMacAppCodeSign({
    appPath: '/Applications/Pichamber.app',
    spawn: () => ({
      status: 1,
      stdout: '',
      stderr: '/Applications/Pichamber.app: code object is not signed at all',
    }),
  });
  assert.deepEqual(inspected, { signed: false, adhoc: false, identity: null });
});

test('points in-place install failures at the GitHub release dmg', () => {
  assert.equal(
    resolveDesktopReleaseUrl({ version: '1.1.0' }),
    'https://github.com/birdmichael/pichamber/releases/tag/v1.1.0',
  );
  assert.match(
    describeInPlaceInstallFailure({ version: '1.1.0', cause: new Error('Could not locate update') }),
    /Could not install the update in-place: Could not locate update.*releases\/tag\/v1\.1\.0.*\.dmg/,
  );
});

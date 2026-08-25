import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  assertDeveloperIdCodesign,
  assertMacReleaseEntitlements,
  inspectCodesignVerbose,
  pickDeveloperIdApplicationIdentity,
  toElectronBuilderCertificateName,
} from './macos-signing.mjs';

const FIND_IDENTITY = `
  1) ABCDEF0123456789ABCDEF0123456789ABCDEF01 "Apple Development: Example (ABC123)"
  2) 0123456789ABCDEF0123456789ABCDEF01234567 "Developer ID Application: Chengdu Wuli Aizhi Technology Co., Ltd (XD3JQBK82H)"
     2 valid identities found
`;

const DEVELOPER_ID_CODESIGN = `
Executable=/tmp/Pichamber.app/Contents/MacOS/Pichamber
Identifier=dev.pichamber.desktop
Format=app bundle with Mach-O thin (arm64)
CodeDirectory v=20500 size=123 flags=0x10000(runtime) hashes=10+7 location=embedded
Signature size=8975
Authority=Developer ID Application: Chengdu Wuli Aizhi Technology Co., Ltd (XD3JQBK82H)
Authority=Developer ID Certification Authority
Authority=Apple Root CA
Timestamp=25 Aug 2026 at 12:00:00
TeamIdentifier=XD3JQBK82H
Runtime Version=15.4.0
Sealed Resources version=2 rules=13 files=200
Internal requirements count=1 size=180
`;

const ADHOC_CODESIGN = `
Identifier=dev.pichamber.desktop
CodeDirectory v=20400 size=123 flags=0x2(adhoc) hashes=10+7 location=embedded
Signature=adhoc
TeamIdentifier=not set
`;

const RELEASE_ENTITLEMENTS = `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0">
<dict>
  <key>com.apple.security.cs.allow-jit</key>
  <true/>
  <key>com.apple.security.cs.allow-unsigned-executable-memory</key>
  <true/>
  <key>com.apple.security.cs.disable-library-validation</key>
  <true/>
</dict>
</plist>
`;

test('picks Developer ID Application from find-identity output', () => {
  assert.equal(
    pickDeveloperIdApplicationIdentity(FIND_IDENTITY),
    'Developer ID Application: Chengdu Wuli Aizhi Technology Co., Ltd (XD3JQBK82H)',
  );
  assert.equal(
    toElectronBuilderCertificateName(pickDeveloperIdApplicationIdentity(FIND_IDENTITY)),
    'Chengdu Wuli Aizhi Technology Co., Ltd (XD3JQBK82H)',
  );
});

test('returns empty when no Developer ID Application identity is present', () => {
  assert.equal(pickDeveloperIdApplicationIdentity('  1) AAA "Apple Development: Example (ABC123)"'), '');
});

test('parses codesign output for Developer ID, ad-hoc, and missing runtime', () => {
  const signed = inspectCodesignVerbose(DEVELOPER_ID_CODESIGN);
  assert.equal(signed.isDeveloperIdApplication, true);
  assert.equal(signed.hasHardenedRuntime, true);
  assert.equal(signed.teamIdentifier, 'XD3JQBK82H');

  const adhoc = inspectCodesignVerbose(ADHOC_CODESIGN);
  assert.equal(adhoc.isDeveloperIdApplication, false);
  assert.equal(adhoc.hasHardenedRuntime, false);
  assert.equal(adhoc.teamIdentifier, 'not set');
});

test('accepts a Developer ID hardened-runtime signature for the expected team', () => {
  const info = assertDeveloperIdCodesign(DEVELOPER_ID_CODESIGN, { teamId: 'XD3JQBK82H' });
  assert.equal(info.teamIdentifier, 'XD3JQBK82H');
});

test('rejects ad-hoc, unsigned, and wrong-team signatures', () => {
  assert.throws(() => assertDeveloperIdCodesign(ADHOC_CODESIGN, { teamId: 'XD3JQBK82H' }), /Developer ID Application/);
  assert.throws(
    () => assertDeveloperIdCodesign(DEVELOPER_ID_CODESIGN.replace('flags=0x10000(runtime)', 'flags=0x0()'), { teamId: 'XD3JQBK82H' }),
    /hardened runtime/,
  );
  assert.throws(() => assertDeveloperIdCodesign(DEVELOPER_ID_CODESIGN, { teamId: 'OTHERTEAM' }), /does not match/);
});

test('requires Electron JIT entitlements and forbids sandbox', () => {
  assert.doesNotThrow(() => assertMacReleaseEntitlements(RELEASE_ENTITLEMENTS));
  assert.throws(
    () => assertMacReleaseEntitlements(`${RELEASE_ENTITLEMENTS.replace('</dict>', '<key>com.apple.security.app-sandbox</key><true/></dict>')}`),
    /app sandbox/,
  );
  assert.throws(
    () => assertMacReleaseEntitlements(RELEASE_ENTITLEMENTS.replace('com.apple.security.cs.allow-jit', 'com.apple.security.cs.allow-unsigned-executable-memory')),
    /allow-jit/,
  );
});

test('CI cert install pins stripped CSC_NAME and does not re-export the p12', () => {
  const script = readFileSync(new URL('./install-apple-desktop-cert.sh', import.meta.url), 'utf8');
  assert.match(script, /macos-signing\.mjs" csc-name/);
  assert.match(script, /echo "CSC_NAME=\$CSC_NAME"/);
  assert.match(script, /echo "csc_name=\$CSC_NAME"/);
  assert.equal(script.includes('CSC_LINK='), false);
  assert.equal(script.includes('CSC_KEY_PASSWORD='), false);
  assert.equal(script.includes('CSC_NAME=$IDENTITY'), false);
});

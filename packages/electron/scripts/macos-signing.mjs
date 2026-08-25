#!/usr/bin/env node
/**
 * Parse macOS codesign / keychain output for Electron desktop signing.
 * Used by install-apple-desktop-cert.sh and verify-macos-app-signature.sh.
 */
import { pathToFileURL } from 'node:url';

const DEVELOPER_ID_APPLICATION = 'Developer ID Application:';
const REQUIRED_ENTITLEMENTS = [
  'com.apple.security.cs.allow-jit',
  'com.apple.security.cs.allow-unsigned-executable-memory',
  'com.apple.security.cs.disable-library-validation',
];

export const pickDeveloperIdApplicationIdentity = (findIdentityOutput) => {
  const line = String(findIdentityOutput)
    .split(/\r?\n/)
    .find((entry) => entry.includes(DEVELOPER_ID_APPLICATION));
  const quoted = line?.match(/"([^"]+)"/);
  return quoted?.[1] ?? '';
};

// electron-builder 26 rejects `CSC_NAME=Developer ID Application: ...` and
// wants the certificate common name without that prefix.
export const toElectronBuilderCertificateName = (identity) => (
  String(identity || '').replace(/^Developer ID Application:\s*/, '')
);

export const inspectCodesignVerbose = (codesignVerboseOutput) => {
  const output = String(codesignVerboseOutput);
  const flags = /flags=([^\s]+)/.exec(output)?.[1] ?? '';
  const teamIdentifier = /TeamIdentifier=(.+)$/m.exec(output)?.[1]?.trim() ?? '';
  const authority = [...output.matchAll(/^Authority=(.+)$/gm)].map((match) => match[1]);
  return {
    flags,
    teamIdentifier,
    authority,
    hasHardenedRuntime: /\bruntime\b/.test(flags),
    isDeveloperIdApplication: authority.some((entry) => entry.startsWith(DEVELOPER_ID_APPLICATION)),
  };
};

export const assertDeveloperIdCodesign = (codesignVerboseOutput, { teamId } = {}) => {
  const info = inspectCodesignVerbose(codesignVerboseOutput);
  if (!info.isDeveloperIdApplication) {
    throw new Error('App is not signed with Developer ID Application');
  }
  if (!info.hasHardenedRuntime) {
    throw new Error('hardened runtime flag missing');
  }
  if (teamId && info.teamIdentifier !== teamId) {
    throw new Error(`TeamIdentifier ${info.teamIdentifier || '(empty)'} does not match ${teamId}`);
  }
  if (info.teamIdentifier === 'not set') {
    throw new Error('TeamIdentifier is not set');
  }
  return info;
};

export const assertMacReleaseEntitlements = (entitlementsPlist) => {
  const xml = String(entitlementsPlist);
  if (xml.includes('com.apple.security.app-sandbox')) {
    throw new Error('app sandbox entitlement is present');
  }
  for (const key of REQUIRED_ENTITLEMENTS) {
    if (!xml.includes(`<key>${key}</key>`)) {
      throw new Error(`required entitlement missing: ${key}`);
    }
  }
};

const readStdin = async () => {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
};

const main = async () => {
  const command = process.argv[2];
  if (command === 'pick-identity') {
    const identity = pickDeveloperIdApplicationIdentity(await readStdin());
    if (!identity) {
      console.error('Developer ID Application identity not found');
      process.exit(1);
    }
    process.stdout.write(`${identity}\n`);
    return;
  }
  if (command === 'csc-name') {
    const input = await readStdin();
    const identity = pickDeveloperIdApplicationIdentity(input) || input.trim();
    const name = toElectronBuilderCertificateName(identity);
    if (!name) {
      console.error('Developer ID Application identity not found');
      process.exit(1);
    }
    process.stdout.write(`${name}\n`);
    return;
  }
  if (command === 'assert-codesign') {
    const teamIndex = process.argv.indexOf('--team');
    const teamId = teamIndex >= 0 ? process.argv[teamIndex + 1] : '';
    const info = assertDeveloperIdCodesign(await readStdin(), { teamId });
    console.log(`Developer ID Application, TeamIdentifier=${info.teamIdentifier}, flags=${info.flags}`);
    return;
  }
  if (command === 'assert-entitlements') {
    assertMacReleaseEntitlements(await readStdin());
    return;
  }
  console.error('Usage: macos-signing.mjs pick-identity | csc-name | assert-codesign [--team TEAM] | assert-entitlements');
  process.exit(2);
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}

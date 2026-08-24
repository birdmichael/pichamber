import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export const PRODUCTION_RELEASES_URL = 'https://github.com/birdmichael/pichamber/releases';

export const resolveDesktopReleaseUrl = ({
  version,
  owner = 'birdmichael',
  repo = 'pichamber',
} = {}) => {
  const normalized = typeof version === 'string' ? version.trim().replace(/^v/i, '') : '';
  if (!normalized) return `${PRODUCTION_RELEASES_URL}`;
  return `https://github.com/${owner}/${repo}/releases/tag/v${normalized}`;
};

export const parseMacCodeSignOutput = (output) => {
  const text = String(output || '');
  if (/code object is not signed|not signed at all/i.test(text)) {
    return { signed: false, adhoc: false, identity: null };
  }
  const adhoc = /Signature=adhoc|flags=0x[0-9a-f]*\(adhoc\)|Authority=.*Ad Hoc/i.test(text);
  const identityMatch = text.match(/Authority=(.+)/);
  const identity = identityMatch?.[1]?.trim() || null;
  const signed = /Signature=|Authority=|CodeDirectory /i.test(text);
  return { signed, adhoc, identity };
};

export const inspectMacAppCodeSign = ({
  appPath,
  spawn = spawnSync,
} = {}) => {
  if (!appPath) {
    return { signed: false, adhoc: false, identity: null };
  }
  const result = spawn('codesign', ['-dv', '--verbose=4', appPath], { encoding: 'utf8' });
  const output = `${result.stdout || ''}\n${result.stderr || ''}\n${result.error?.message || ''}`;
  const parsed = parseMacCodeSignOutput(output);
  if (!parsed.signed && result.status === 0 && /Signature=|Authority=|CodeDirectory /i.test(output)) {
    return parsed;
  }
  return parsed;
};

/**
 * In-place electron-updater install needs a Developer ID / notarized Mac
 * build. Unsigned and ad-hoc (`codesign -s -`) apps can download a payload
 * but quitAndInstall() fails and must not be reported as success.
 */
export const canInstallDesktopUpdateInPlace = ({
  platform = process.platform,
  packaged = false,
  macCodeSign = null,
} = {}) => {
  if (!packaged) return false;
  if (platform !== 'darwin') return true;
  if (!macCodeSign?.signed || macCodeSign.adhoc) return false;
  return true;
};

export const describeInPlaceInstallFailure = ({
  version,
  cause,
} = {}) => {
  const releaseUrl = resolveDesktopReleaseUrl({ version });
  const detail = cause instanceof Error && cause.message
    ? cause.message
    : (typeof cause === 'string' && cause.trim() ? cause.trim() : '');
  const prefix = detail
    ? `Could not install the update in-place: ${detail}`
    : 'This Mac build cannot install updates in-place (unsigned or ad-hoc signed)';
  return `${prefix}. Open ${releaseUrl} and replace Pichamber.app from the .dmg.`;
};

export const assertUpdaterCapability = ({
  platform = process.platform,
  packaged,
  appImagePath = process.env.APPIMAGE,
  access = fs.accessSync,
  stat = fs.statSync,
} = {}) => {
  if (platform !== 'linux' || !packaged) return;

  if (!appImagePath) {
    throw new Error(
      'Updates require the packaged Linux AppImage. Start Pichamber from its .AppImage file, not an extracted or repackaged copy.',
    );
  }
  if (!path.isAbsolute(appImagePath)) {
    throw new Error(`Updates require APPIMAGE to be an absolute path, got: ${appImagePath}`);
  }

  try {
    if (!stat(appImagePath).isFile()) throw new Error('not a file');
  } catch {
    throw new Error(`The running AppImage cannot be found at ${appImagePath}. Start Pichamber from a valid .AppImage file.`);
  }

  try {
    access(appImagePath, fs.constants.W_OK);
  } catch {
    throw new Error(
      `The AppImage is not writable at ${appImagePath}. Move it to a writable location or grant write permission before updating.`,
    );
  }
};

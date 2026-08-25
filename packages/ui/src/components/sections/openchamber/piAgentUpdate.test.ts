import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  canUpdatePiFromStatus,
  isPiUpToDate,
  parsePiUpgradeStatus,
  shouldShowPiLatestVersion,
} from './piAgentUpdate';

describe('piAgentUpdate', () => {
  test('parses the existing upgrade-status payload and ignores a missing latest', () => {
    expect(parsePiUpgradeStatus({
      available: false,
      currentVersion: '0.84.2',
      latestVersion: null,
    })).toEqual({
      available: false,
      currentVersion: '0.84.2',
      latestVersion: null,
    });
    expect(parsePiUpgradeStatus(null)).toBeNull();
  });

  test('shows latest and Update only when the banner source reports an update', () => {
    const available = parsePiUpgradeStatus({
      available: true,
      currentVersion: '0.84.2',
      latestVersion: '0.90.0',
    });
    expect(shouldShowPiLatestVersion(available)).toBe(true);
    expect(canUpdatePiFromStatus(available)).toBe(true);
    expect(isPiUpToDate(available)).toBe(false);
  });

  test('hides latest and Update when already current or latest is unknown', () => {
    const current = parsePiUpgradeStatus({
      available: false,
      currentVersion: '0.90.0',
      latestVersion: '0.90.0',
    });
    expect(shouldShowPiLatestVersion(current)).toBe(false);
    expect(canUpdatePiFromStatus(current)).toBe(false);
    expect(isPiUpToDate(current)).toBe(true);

    const unknownLatest = parsePiUpgradeStatus({
      available: false,
      currentVersion: '0.84.2',
      latestVersion: null,
    });
    expect(shouldShowPiLatestVersion(unknownLatest)).toBe(false);
    expect(canUpdatePiFromStatus(unknownLatest)).toBe(false);
    expect(isPiUpToDate(unknownLatest)).toBe(false);
  });
});

describe('PiAgentSettings version display', () => {
  test('shows muted current version text and Update, not chips or Current / Latest labels', () => {
    const source = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), 'PiAgentSettings.tsx'),
      'utf8',
    );
    expect(source).toContain('SETTINGS_VERSION_META_CLASS');
    expect(source).not.toContain('SettingsVersionChips');
    expect(source).not.toContain("label={t('settings.openchamber.piAgent.field.currentVersion')}");
    expect(source).not.toContain("label={t('settings.openchamber.piAgent.field.latestVersion')}");
    expect(source).not.toContain('actions.upToDate');
    expect(source).toContain('updateToVersion');
    expect(source).toContain('data-settings-item="sessions.pi-update"');
    expect(source).toContain('SETTINGS_ACTION_BUTTON_CLASS');
    expect(source).toContain('justify-start');
    expect(source).not.toContain('justify-between');
    expect(source).not.toContain('justify-end');
  });
});

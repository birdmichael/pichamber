import { beforeEach, describe, expect, test } from 'bun:test';

import {
    compareOpenCodeUpdateVersions,
    dismissOpenCodeUpdateToast,
    normalizeOpenCodeUpdateVersion,
    rememberOpenCodeUpdateToastDismiss,
    resetRememberedOpenCodeUpdateDismiss,
    resolveDismissedOpenCodeUpdateVersion,
    resolveOpenCodeUpdateVersion,
    resolveOpenCodeUpgradeStatusVersion,
    resolvePiUpgradeStatusVersion,
    shouldShowOpenCodeUpdateToast,
    shouldShowPwaInstallToast,
} from '../openCodeUpdateDedup';

describe('shouldShowPwaInstallToast', () => {
    test('returns true when nothing blocks the toast', () => {
        expect(
            shouldShowPwaInstallToast({
                dismissed: null,
                sessionShown: null,
                hasActiveToast: false,
            }),
        ).toBe(true);
    });

    test('returns false when persistent dismissal is set', () => {
        expect(
            shouldShowPwaInstallToast({
                dismissed: 'true',
                sessionShown: null,
                hasActiveToast: false,
            }),
        ).toBe(false);
    });

    test('returns false when the toast was already shown in this session', () => {
        expect(
            shouldShowPwaInstallToast({
                dismissed: null,
                sessionShown: 'true',
                hasActiveToast: false,
            }),
        ).toBe(false);
    });

    test('returns false when the effect already owns an active toast', () => {
        expect(
            shouldShowPwaInstallToast({
                dismissed: null,
                sessionShown: null,
                hasActiveToast: true,
            }),
        ).toBe(false);
    });

    test('treats non-"true" storage values as unset', () => {
        expect(
            shouldShowPwaInstallToast({
                dismissed: 'false',
                sessionShown: '0',
                hasActiveToast: false,
            }),
        ).toBe(true);
    });

    test('persistent dismissal wins even when session marker is also set', () => {
        expect(
            shouldShowPwaInstallToast({
                dismissed: 'true',
                sessionShown: 'true',
                hasActiveToast: false,
            }),
        ).toBe(false);
    });
});

describe('shouldShowOpenCodeUpdateToast', () => {
    test('returns true for a fresh version with no dismissal and an empty seen set', () => {
        expect(
            shouldShowOpenCodeUpdateToast({
                version: '1.16.0',
                dismissedVersion: null,
                seenVersions: new Set(),
            }),
        ).toBe(true);
    });

    test('returns false for an empty version string', () => {
        expect(
            shouldShowOpenCodeUpdateToast({
                version: '',
                dismissedVersion: null,
                seenVersions: new Set(),
            }),
        ).toBe(false);
    });

    test('returns false when the version was already surfaced in this session', () => {
        expect(
            shouldShowOpenCodeUpdateToast({
                version: '1.16.0',
                dismissedVersion: null,
                seenVersions: new Set(['1.16.0']),
            }),
        ).toBe(false);
    });

    test('returns false when the dismissed version matches the incoming version', () => {
        expect(
            shouldShowOpenCodeUpdateToast({
                version: '1.16.0',
                dismissedVersion: '1.16.0',
                seenVersions: new Set(),
            }),
        ).toBe(false);
    });

    test('returns true when a different version was previously dismissed', () => {
        expect(
            shouldShowOpenCodeUpdateToast({
                version: '1.17.0',
                dismissedVersion: '1.16.0',
                seenVersions: new Set(),
            }),
        ).toBe(true);
    });

    test('treats null dismissedVersion as no prior dismissal', () => {
        expect(
            shouldShowOpenCodeUpdateToast({
                version: '1.16.0',
                dismissedVersion: null,
                seenVersions: new Set(['1.15.0']),
            }),
        ).toBe(true);
    });

    test('seen set blocks even when dismissed version differs', () => {
        expect(
            shouldShowOpenCodeUpdateToast({
                version: '1.16.0',
                dismissedVersion: '1.15.0',
                seenVersions: new Set(['1.16.0']),
            }),
        ).toBe(false);
    });

    test('treats a v-prefixed dismissed version as the same release', () => {
        expect(
            shouldShowOpenCodeUpdateToast({
                version: '0.84.3',
                dismissedVersion: 'v0.84.3',
                seenVersions: new Set(),
            }),
        ).toBe(false);
        expect(
            shouldShowOpenCodeUpdateToast({
                version: 'v0.84.3',
                dismissedVersion: '0.84.3',
                seenVersions: new Set(['0.84.3']),
            }),
        ).toBe(false);
    });

    test('hides an older available version after a newer one was dismissed', () => {
        expect(
            shouldShowOpenCodeUpdateToast({
                version: '0.84.2',
                dismissedVersion: '0.84.3',
                seenVersions: new Set(),
            }),
        ).toBe(false);
    });

    test('shows again when a newer version is available after dismiss', () => {
        expect(
            shouldShowOpenCodeUpdateToast({
                version: '0.85.0',
                dismissedVersion: '0.84.3',
                seenVersions: new Set(),
            }),
        ).toBe(true);
    });
});

describe('openCode update toast dismiss path', () => {
    beforeEach(() => {
        resetRememberedOpenCodeUpdateDismiss();
    });

    test('normalizes and compares Pi versions without a hardcoded provider', () => {
        expect(normalizeOpenCodeUpdateVersion(' v0.84.3 ')).toBe('0.84.3');
        expect(compareOpenCodeUpdateVersions('0.85.0', '0.84.3')).toBeGreaterThan(0);
        expect(compareOpenCodeUpdateVersions('0.84.3', 'v0.84.3')).toBe(0);
    });

    test('Dismiss and the toast close control persist the version so retries do not re-show it', () => {
        const persisted: string[] = [];
        let hidden = 0;

        const persistDismissedVersion = (version: string) => {
            persisted.push(version);
        };
        const hideToast = () => {
            hidden += 1;
        };

        expect(
            dismissOpenCodeUpdateToast({
                version: '0.84.3',
                persistDismissedVersion,
                hideToast,
            }),
        ).toBe('0.84.3');
        // Sonner OK / X / swipe also go through the same helper via onDismiss.
        expect(
            dismissOpenCodeUpdateToast({
                version: '0.84.3',
                persistDismissedVersion,
                hideToast,
            }),
        ).toBe('0.84.3');

        expect(hidden).toBe(2);
        expect(persisted).toEqual(['0.84.3', '0.84.3']);
        expect(resolveDismissedOpenCodeUpdateVersion(null)).toBe('0.84.3');
        expect(
            shouldShowOpenCodeUpdateToast({
                version: '0.84.3',
                dismissedVersion: resolveDismissedOpenCodeUpdateVersion(null),
                seenVersions: new Set(),
            }),
        ).toBe(false);
        expect(
            shouldShowOpenCodeUpdateToast({
                version: '0.84.3',
                dismissedVersion: resolveDismissedOpenCodeUpdateVersion('0.84.3'),
                seenVersions: new Set(),
            }),
        ).toBe(false);
    });

    test('hides the toast even when persist throws', () => {
        let hidden = 0;
        expect(
            dismissOpenCodeUpdateToast({
                version: '0.84.3',
                persistDismissedVersion: () => {
                    throw new Error('settings write failed');
                },
                hideToast: () => {
                    hidden += 1;
                },
            }),
        ).toBe('0.84.3');
        expect(hidden).toBe(1);
        expect(
            shouldShowOpenCodeUpdateToast({
                version: '0.84.3',
                dismissedVersion: resolveDismissedOpenCodeUpdateVersion(null),
                seenVersions: new Set(),
            }),
        ).toBe(false);
    });

    test('remembers dismiss in-memory so a storage miss cannot resurrect the toast', () => {
        rememberOpenCodeUpdateToastDismiss('0.84.3');
        expect(resolveDismissedOpenCodeUpdateVersion(null)).toBe('0.84.3');
        expect(resolveDismissedOpenCodeUpdateVersion('0.80.0')).toBe('0.84.3');
        expect(
            shouldShowOpenCodeUpdateToast({
                version: '0.84.3',
                dismissedVersion: resolveDismissedOpenCodeUpdateVersion(''),
                seenVersions: new Set(),
            }),
        ).toBe(false);
    });
});

describe('resolveOpenCodeUpdateVersion', () => {
    test('returns the trimmed version when detail.version is a string', () => {
        expect(resolveOpenCodeUpdateVersion({ version: '1.16.0' })).toBe('1.16.0');
    });

    test('trims surrounding whitespace from a string version', () => {
        expect(resolveOpenCodeUpdateVersion({ version: '  1.16.0  ' })).toBe('1.16.0');
    });

    test('returns empty string when detail is null', () => {
        expect(resolveOpenCodeUpdateVersion(null)).toBe('');
    });

    test('returns empty string when detail is undefined', () => {
        expect(resolveOpenCodeUpdateVersion(undefined)).toBe('');
    });

    test('returns empty string when detail is not an object', () => {
        expect(resolveOpenCodeUpdateVersion('1.16.0')).toBe('');
        expect(resolveOpenCodeUpdateVersion(42)).toBe('');
        expect(resolveOpenCodeUpdateVersion(true)).toBe('');
    });

    test('returns empty string when the version field is missing', () => {
        expect(resolveOpenCodeUpdateVersion({})).toBe('');
    });

    test('returns empty string when the version field is non-string', () => {
        expect(resolveOpenCodeUpdateVersion({ version: 116 })).toBe('');
        expect(resolveOpenCodeUpdateVersion({ version: null })).toBe('');
        expect(resolveOpenCodeUpdateVersion({ version: { major: 1 } })).toBe('');
    });
});

describe('resolveOpenCodeUpgradeStatusVersion', () => {
    test('returns the trimmed latestVersion when available is true', () => {
        expect(
            resolveOpenCodeUpgradeStatusVersion({
                available: true,
                latestVersion: '1.16.0',
                upgrade: { supported: true },
            }),
        ).toBe('1.16.0');
    });

    test('trims surrounding whitespace from latestVersion', () => {
        expect(
            resolveOpenCodeUpgradeStatusVersion({
                available: true,
                latestVersion: '  1.16.0  ',
                upgrade: { supported: true },
            }),
        ).toBe('1.16.0');
    });

    test('returns empty string when status is null', () => {
        expect(resolveOpenCodeUpgradeStatusVersion(null)).toBe('');
    });

    test('returns empty string when status is undefined', () => {
        expect(resolveOpenCodeUpgradeStatusVersion(undefined)).toBe('');
    });

    test('returns empty string when available is false', () => {
        expect(
            resolveOpenCodeUpgradeStatusVersion({
                available: false,
                latestVersion: '1.16.0',
            }),
        ).toBe('');
    });

    test('fails closed when the server does not explicitly support upgrades', () => {
        expect(
            resolveOpenCodeUpgradeStatusVersion({
                available: true,
                latestVersion: '1.16.0',
            }),
        ).toBe('');
        expect(
            resolveOpenCodeUpgradeStatusVersion({
                available: true,
                latestVersion: '1.16.0',
                upgrade: { supported: false },
            }),
        ).toBe('');
    });

    test('returns empty string when available is missing or null', () => {
        expect(
            resolveOpenCodeUpgradeStatusVersion({
                latestVersion: '1.16.0',
            }),
        ).toBe('');
        expect(
            resolveOpenCodeUpgradeStatusVersion({
                available: null,
                latestVersion: '1.16.0',
            }),
        ).toBe('');
    });

    test('returns empty string when latestVersion is missing', () => {
        expect(resolveOpenCodeUpgradeStatusVersion({ available: true })).toBe('');
    });

    test('returns empty string when latestVersion is non-string', () => {
        expect(
            resolveOpenCodeUpgradeStatusVersion({
                available: true,
                latestVersion: null,
            }),
        ).toBe('');
    });
});

describe('resolvePiUpgradeStatusVersion', () => {
    test('returns the latest SDK version when available even if upgrade is unsupported', () => {
        expect(
            resolvePiUpgradeStatusVersion({
                available: true,
                latestVersion: '0.90.0',
                upgrade: { supported: false },
            }),
        ).toBe('0.90.0');
    });

    test('does not treat leftover OpenCode upgrade.supported as required', () => {
        expect(
            resolveOpenCodeUpgradeStatusVersion({
                available: true,
                latestVersion: '0.90.0',
                upgrade: { supported: false },
            }),
        ).toBe('');
        expect(
            resolvePiUpgradeStatusVersion({
                available: true,
                latestVersion: '0.90.0',
                upgrade: { supported: false },
            }),
        ).toBe('0.90.0');
    });

    test('returns empty string when the check did not find an update', () => {
        expect(
            resolvePiUpgradeStatusVersion({
                available: false,
                latestVersion: '0.90.0',
            }),
        ).toBe('');
        expect(resolvePiUpgradeStatusVersion(null)).toBe('');
    });
});

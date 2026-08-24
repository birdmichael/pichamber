import { describe, expect, test } from 'bun:test';

import {
  PICHAMBER_GITHUB_RELEASES_URL,
  resolveDesktopUpdateReleaseUrl,
  shouldOfferDesktopInPlaceInstall,
} from './desktopUpdateInstall';

describe('shouldOfferDesktopInPlaceInstall', () => {
  test('offers Restart to Update only when Desktop says in-place install works', () => {
    expect(shouldOfferDesktopInPlaceInstall('desktop', { canInstallInPlace: true })).toBe(true);
  });

  test('hides in-app install for unsigned or ad-hoc Desktop builds', () => {
    expect(shouldOfferDesktopInPlaceInstall('desktop', { canInstallInPlace: false })).toBe(false);
    expect(shouldOfferDesktopInPlaceInstall('desktop', {})).toBe(false);
    expect(shouldOfferDesktopInPlaceInstall('desktop', null)).toBe(false);
  });

  test('does not offer Desktop in-place install on other runtimes', () => {
    expect(shouldOfferDesktopInPlaceInstall('web', { canInstallInPlace: true })).toBe(false);
    expect(shouldOfferDesktopInPlaceInstall('mobile', { canInstallInPlace: true })).toBe(false);
  });
});

describe('resolveDesktopUpdateReleaseUrl', () => {
  test('prefers the release URL from Desktop, then a version tag', () => {
    expect(resolveDesktopUpdateReleaseUrl({
      releaseUrl: 'https://github.com/birdmichael/pichamber/releases/tag/v1.1.0',
      version: '1.2.0',
    })).toBe('https://github.com/birdmichael/pichamber/releases/tag/v1.1.0');
    expect(resolveDesktopUpdateReleaseUrl({ version: '1.1.0' })).toBe(
      `${PICHAMBER_GITHUB_RELEASES_URL}/tag/v1.1.0`,
    );
    expect(resolveDesktopUpdateReleaseUrl(null)).toBe(PICHAMBER_GITHUB_RELEASES_URL);
  });
});

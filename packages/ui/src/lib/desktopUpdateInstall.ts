import type { UpdateInfo } from '@/lib/desktop';

export const PICHAMBER_GITHUB_RELEASES_URL = 'https://github.com/birdmichael/pichamber/releases';

export const resolveDesktopUpdateReleaseUrl = (
  info: Pick<UpdateInfo, 'releaseUrl' | 'downloadUrl' | 'version'> | null | undefined,
): string => {
  if (typeof info?.releaseUrl === 'string' && info.releaseUrl.trim()) {
    return info.releaseUrl.trim();
  }
  if (typeof info?.downloadUrl === 'string' && info.downloadUrl.trim()) {
    return info.downloadUrl.trim();
  }
  const version = typeof info?.version === 'string' ? info.version.trim().replace(/^v/i, '') : '';
  return version
    ? `${PICHAMBER_GITHUB_RELEASES_URL}/tag/v${version}`
    : PICHAMBER_GITHUB_RELEASES_URL;
};

/**
 * Unsigned and ad-hoc Mac builds cannot run quitAndInstall(). Only an
 * explicit `canInstallInPlace: true` from Desktop may offer in-app install.
 */
export const shouldOfferDesktopInPlaceInstall = (
  runtimeType: 'desktop' | 'web' | 'vscode' | 'mobile' | null | undefined,
  info: Pick<UpdateInfo, 'canInstallInPlace'> | null | undefined,
): boolean => runtimeType === 'desktop' && info?.canInstallInPlace === true;

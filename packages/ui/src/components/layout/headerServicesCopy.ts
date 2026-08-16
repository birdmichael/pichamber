import type { I18nKey } from '@/lib/i18n';

export function headerServicesOpenAriaKey(
  isDesktopApp: boolean,
  isPiKernel: boolean,
  isMcpFeaturePluginActive = false,
): I18nKey {
  if (!isDesktopApp) {
    if (isPiKernel) {
      return isMcpFeaturePluginActive
        ? 'header.services.openPiWithMcp'
        : 'header.services.openPi';
    }
    return 'header.services.open';
  }

  return isPiKernel
    ? 'header.services.openWithCurrentPi'
    : 'header.services.openWithCurrent';
}

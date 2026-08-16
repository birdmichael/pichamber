import type { I18nKey } from '@/lib/i18n';

export function headerServicesOpenAriaKey(isDesktopApp: boolean, isPiKernel: boolean): I18nKey {
  if (!isDesktopApp) {
    return 'header.services.open';
  }

  return isPiKernel
    ? 'header.services.openWithCurrentPi'
    : 'header.services.openWithCurrent';
}

/**
 * Hosted MobileApp toast placement. Sonner uses `--mobile-offset-*` (default
 * 16px) below 600px and ignores `offset`, so iPhone Safari / home-screen
 * mobile.html sat under the status bar. Capacitor and standalone already
 * patched `top` in CSS; this contract is the shared inset for both props
 * and the `.oc-mobile-toaster` rule.
 *
 * Prefer the larger of the app token and `env(safe-area-inset-*)`:
 * Android Capacitor injects `--oc-safe-area-*` while `env()` is 0;
 * iOS Safari reports `env()` even when the token is still the 0px default.
 */
export const MOBILE_TOASTER_CLASS = 'oc-mobile-toaster';

const MOBILE_TOASTER_SAFE_GAP_PX = 16;

export const MOBILE_TOASTER_SAFE_AREA_OFFSET = {
  top: mobileToasterOffsetCss('top'),
  bottom: mobileToasterOffsetCss('bottom'),
} as const;

export function mobileToasterOffsetCss(side: 'top' | 'bottom'): string {
  const token = side === 'top' ? '--oc-safe-area-top' : '--oc-safe-area-bottom';
  const envName = side === 'top' ? 'safe-area-inset-top' : 'safe-area-inset-bottom';
  return `calc(max(var(${token}, 0px), env(${envName}, 0px)) + ${MOBILE_TOASTER_SAFE_GAP_PX}px)`;
}

/** Pixel inset for fixtures that simulate `env(safe-area-inset-*)`. */
export function resolveMobileToasterInsetPx(safeAreaInsetPx: number): number {
  return Math.max(0, safeAreaInsetPx) + MOBILE_TOASTER_SAFE_GAP_PX;
}

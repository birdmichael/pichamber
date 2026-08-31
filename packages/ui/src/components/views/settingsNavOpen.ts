/**
 * Settings home nav used to open a page on pointerdown so a desktop click
 * felt instant. On the mobile layout (and on touch/pen) that fires at
 * finger-down, so a swipe to scroll the list navigates instead.
 *
 * Desktop mouse primary press may still open immediately. Mobile layout
 * always waits for click so the nav can pan, even when the pointer is a
 * mouse (hosted mobile.html / DevTools device mode).
 */
export const shouldOpenSettingsNavOnPointerDown = (
  event: { button: number; pointerType: string },
  options: { isMobile?: boolean } = {},
): boolean => {
  if (options.isMobile) return false;
  return event.button === 0 && event.pointerType === 'mouse';
};

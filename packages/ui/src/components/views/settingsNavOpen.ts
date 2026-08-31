/**
 * Settings home nav used to open a page on pointerdown so a desktop click
 * felt instant. On touch that same handler fires at finger-down, so a swipe
 * to scroll the list navigates instead.
 *
 * Mouse primary press may still open immediately. Touch and pen wait for
 * click (press + release with little movement) so the nav can pan.
 */
export const shouldOpenSettingsNavOnPointerDown = (event: {
  button: number;
  pointerType: string;
}): boolean => event.button === 0 && event.pointerType === 'mouse';

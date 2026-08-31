/**
 * Sessions "+ new chat" is a header control, not a pan-y list row.
 *
 * Hosted mobile.html / DevTools can swallow the first `click` (sticky
 * :hover tap, leftover overlay dismiss on pointerdown). Activate on
 * primary pointerdown so the first tap closes the drawer and opens a
 * projectless Chats draft. `click` stays the keyboard / fallback path.
 *
 * Unlike Settings nav (#375), waiting for click here *is* the bug: the
 * first tap is a no-op and the second tap finally fires click. This
 * button is not in a swipe-scroll list, so pointerdown is safe.
 */
export const shouldStartMobileNewChatOnPointerDown = (
  event: { button: number; pointerType?: string },
): boolean => event.button === 0;

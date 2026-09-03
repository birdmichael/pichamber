const OPEN_DROPDOWN_SELECTOR = [
  '[data-slot="dropdown-menu-content"][data-open]',
  '[data-slot="select-content"][data-open]',
].join(',');

const EDITABLE_SELECTOR = 'input, textarea, select, [contenteditable="true"], .cm-content, .cm-editor';

export function hasOpenDropdown(root: ParentNode = document): boolean {
  return Boolean(root.querySelector(OPEN_DROPDOWN_SELECTOR));
}

export function shouldStopDropdownImeEscape(
  event: Pick<KeyboardEvent, 'isComposing' | 'key' | 'keyCode'>,
  dropdownOpen: boolean,
): boolean {
  return dropdownOpen
    && event.key === 'Escape'
    && (event.isComposing || event.keyCode === 229);
}

export function isEditableEventTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tagName = target.tagName;
  if (tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT') return true;
  return Boolean(target.closest(EDITABLE_SELECTOR));
}

/** Unmodified typing in a *different* editable field than the leader press is not a chord. */
export function shouldClearShortcutPrefixForTyping(
  event: Pick<KeyboardEvent, 'altKey' | 'ctrlKey' | 'metaKey' | 'target'>,
  prefixTarget: EventTarget | null,
): boolean {
  if (event.ctrlKey || event.metaKey || event.altKey) return false;
  if (!isEditableEventTarget(event.target)) return false;
  return event.target !== prefixTarget;
}

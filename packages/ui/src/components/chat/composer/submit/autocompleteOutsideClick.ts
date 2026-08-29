/** Mark on the composer send control so slash/@/# popups do not steal its click. */
export const COMPOSER_SEND_ATTR = 'data-composer-send';

export const isComposerSendPointerTarget = (target: EventTarget | null): boolean => {
    if (!target || !(target instanceof Element)) return false;
    return target.closest(`[${COMPOSER_SEND_ATTR}]`) != null;
};

/**
 * Dismiss an autocomplete overlay on outside pointerdown, except when the
 * pointer is already on send. Closing first reflows the composer and the
 * click misses the moved send button.
 */
export const shouldDismissAutocompleteOnOutsidePointer = (
    target: EventTarget | null,
    container: Node | null,
): boolean => {
    if (!target || !container) return false;
    if (container.contains(target as Node)) return false;
    if (isComposerSendPointerTarget(target)) return false;
    return true;
};

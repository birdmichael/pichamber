/**
 * Desktop focus mode (Ctrl+Shift+E): Esc in the composer should exit expand
 * without waiting for a second Ctrl+Shift+E toggle (#574).
 *
 * Autocomplete and shell-mode Esc still win first — same order as ChatInput.
 */

export type ExpandedInputEscapeInput = {
  key: string;
  isExpandedInput: boolean;
  isMobile?: boolean;
  /** Slash / mention / skill / snippet picker is open. */
  autocompleteOpen?: boolean;
  /** `!` shell mode — Esc returns to normal input first. */
  inputMode?: 'normal' | 'shell' | string;
};

export function shouldCollapseExpandedInputOnEscape(input: ExpandedInputEscapeInput): boolean {
  if (input.key !== 'Escape') return false;
  if (!input.isExpandedInput) return false;
  if (input.isMobile) return false;
  if (input.autocompleteOpen) return false;
  if (input.inputMode === 'shell') return false;
  return true;
}

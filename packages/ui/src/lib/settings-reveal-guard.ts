export type SettingsRevealPointerPhase = 'pointerdown' | 'pointerup' | 'click';

/** True when the first leftover pointer on a newly revealed Settings row must be swallowed. */
export function shouldConsumeSettingsRevealEvent(input: {
  armed: boolean;
  insideRevealed: boolean;
  isKeyboardClick?: boolean;
}): boolean {
  return input.armed && input.insideRevealed && input.isKeyboardClick !== true;
}

/** Stay armed through the first pointer-down/up; clear after that click or any outside press. */
export function nextSettingsRevealArmed(input: {
  armed: boolean;
  phase: SettingsRevealPointerPhase;
  insideRevealed: boolean;
  isKeyboardClick?: boolean;
}): boolean {
  if (!input.armed) {
    return false;
  }
  if (!input.insideRevealed) {
    return false;
  }
  if (input.isKeyboardClick || input.phase === 'click') {
    return false;
  }
  return true;
}

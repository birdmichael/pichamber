export const SETTINGS_REVEAL_GUARD_MS = 400;

/** True while a newly revealed Settings row should ignore the leftover click. */
export function isSettingsRevealArmed(revealedAtMs: number, nowMs: number): boolean {
  return revealedAtMs > 0 && nowMs - revealedAtMs < SETTINGS_REVEAL_GUARD_MS;
}

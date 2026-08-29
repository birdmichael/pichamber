/**
 * Mount key for the chat composer.
 *
 * ChatInput keeps one live `message` string. Reusing that instance across
 * sessions is what made a typed draft look global. Keying the mount by
 * session or new-session draft gives each composer its own React state.
 * Persistence still owns restore after remount.
 */
export function composerInstanceKey(input: {
  sessionId: string | null;
  draftId?: number | null;
}): string {
  if (input.sessionId) return `session:${input.sessionId}`;
  if (input.draftId != null) return `draft:${input.draftId}`;
  return 'composer';
}

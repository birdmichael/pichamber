/** Message-history walk in the composer. Alt/Ctrl/Meta arrows are session or OS chords, not history. */
export const composerHistoryStepFromKey = (
  event: Pick<KeyboardEvent, 'altKey' | 'ctrlKey' | 'key' | 'metaKey'>,
): 'older' | 'newer' | null => {
  if (event.altKey || event.ctrlKey || event.metaKey) return null;
  if (event.key === 'ArrowUp') return 'older';
  if (event.key === 'ArrowDown') return 'newer';
  return null;
};

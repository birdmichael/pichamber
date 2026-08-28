/**
 * Session titles that mean "this chat has no name yet".
 *
 * Pi list/hydrate can surface several placeholders for the same empty
 * session (`New session`, `Pi session`, `(no messages)`, empty). Chrome
 * that shows a session name must treat them as one untitled label.
 */
const PLACEHOLDER_SESSION_TITLES = new Set([
  'new session',
  'pi session',
  'untitled',
  'untitled session',
  '(no messages)',
  'no messages',
]);

export const isPlaceholderSessionTitle = (title: unknown): boolean => {
  const trimmed = typeof title === 'string' ? title.trim() : '';
  return !trimmed || PLACEHOLDER_SESSION_TITLES.has(trimmed.toLowerCase());
};

const isUnhelpfulSessionTitle = (title: string): boolean => (
  /^Goal mode is active\./i.test(title) || /^(继续|continue)$/i.test(title)
);

export const resolveSessionDisplayTitle = (
  title: unknown,
  untitledLabel: string,
): string => {
  const trimmed = typeof title === 'string' ? title.trim() : '';
  if (!trimmed || isPlaceholderSessionTitle(trimmed) || isUnhelpfulSessionTitle(trimmed)) {
    return untitledLabel;
  }
  return trimmed;
};

/**
 * Archive list filter/restore predicates shared by Desktop ArchiveView and
 * the mobile Archive surface. Restore writes `time.archived = 0`; every
 * reader treats a falsy archived timestamp as active.
 */

type ArchiveTimeFields = {
  title?: string | null;
  time?: {
    archived?: number | null;
  } | null;
};

export const isActiveSessionRecord = (session: ArchiveTimeFields): boolean => (
  !session.time?.archived
);

export const sortArchivedSessionsByTime = <T extends ArchiveTimeFields>(sessions: readonly T[]): T[] => (
  [...sessions].sort((a, b) => (b.time?.archived ?? 0) - (a.time?.archived ?? 0))
);

export const filterArchivedSessions = <T extends ArchiveTimeFields>(
  sessions: readonly T[],
  options: {
    query: string;
    selectedDirectory: string | null;
    getDirectory: (session: T) => string;
  },
): T[] => {
  const normalizedQuery = options.query.trim().toLowerCase();
  if (normalizedQuery) {
    return sessions.filter((session) => (session.title ?? '').toLowerCase().includes(normalizedQuery));
  }
  if (options.selectedDirectory === null) return [...sessions];
  return sessions.filter((session) => options.getDirectory(session) === options.selectedDirectory);
};

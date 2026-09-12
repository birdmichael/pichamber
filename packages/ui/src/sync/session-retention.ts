import type { Session } from '@opencode-ai/sdk/v2';
import { getBtwSessionID } from '@/lib/sessionBtwMetadata';
import type { SessionRetentionAction } from '@/stores/useUIStore';

const DAY_MS = 86_400_000;
export const RETENTION_KEEP_RECENT = 5;

const retentionTimestamp = (session: Session, onlyArchived: boolean): number => (
  onlyArchived ? session.time.archived ?? 0 : session.time.updated ?? session.time.created
);

const isOlderThanCutoff = (session: Session, cutoff: number, onlyArchived: boolean): boolean => {
  const timestamp = retentionTimestamp(session, onlyArchived);
  return Number.isFinite(timestamp) && timestamp > 0 && timestamp < cutoff;
};

type CandidateOptions = {
  sessions: readonly Session[];
  currentSessionId: string | null;
  cutoffDays: number;
  action: SessionRetentionAction;
  onlyArchived?: boolean;
  activeSessionIds?: ReadonlySet<string>;
  now?: number;
};

/** The unselected scope stays protected, including from cascading parent deletion. */
export function buildSessionRetentionCandidates({
  sessions, currentSessionId, cutoffDays, action, onlyArchived = false, activeSessionIds = new Set(), now = Date.now(),
}: CandidateOptions): string[] {
  if (!Number.isFinite(cutoffDays) || cutoffDays < 1) return [];
  const cutoff = now - cutoffDays * DAY_MS;
  const byId = new Map(sessions.map((session) => [session.id, session]));
  const sorted = sessions.filter((session) => Boolean(session.time.archived) === onlyArchived)
    .sort((a, b) => retentionTimestamp(b, onlyArchived) - retentionTimestamp(a, onlyArchived));
  const protectedIds = new Set(sorted.slice(0, RETENTION_KEEP_RECENT).map((session) => session.id));
  for (const session of sessions) {
    if (Boolean(session.time.archived) !== onlyArchived || session.share || getBtwSessionID(session) || session.id === currentSessionId
      || activeSessionIds.has(session.id) || !isOlderThanCutoff(session, cutoff, onlyArchived)) {
      protectedIds.add(session.id);
    }
  }
  if (action === 'delete' || onlyArchived) {
    for (const id of protectedIds) {
      const parentId = byId.get(id)?.parentID;
      if (parentId) protectedIds.add(parentId);
    }
  }
  const candidates = sorted.filter((session) => !protectedIds.has(session.id));
  if (action === 'archive' && !onlyArchived) return candidates.map((session) => session.id);

  const ids = new Set(candidates.map((session) => session.id));
  const childrenLeft = new Map<string, number>();
  for (const session of candidates) {
    if (session.parentID && ids.has(session.parentID)) {
      childrenLeft.set(session.parentID, (childrenLeft.get(session.parentID) ?? 0) + 1);
    }
  }
  const ordered = candidates.filter((session) => !childrenLeft.has(session.id)).map((session) => session.id);
  for (let index = 0; index < ordered.length; index += 1) {
    const parentId = byId.get(ordered[index])?.parentID;
    if (!parentId || !ids.has(parentId)) continue;
    const remaining = (childrenLeft.get(parentId) ?? 0) - 1;
    childrenLeft.set(parentId, remaining);
    if (remaining === 0) ordered.push(parentId);
  }
  return ordered;
}

export function isRetentionEligible(
  session: Session,
  {
    onlyArchived,
    currentSessionId,
    activeSessionIds,
    cutoffDays,
    now = Date.now(),
  }: {
    onlyArchived: boolean;
    currentSessionId: string | null;
    activeSessionIds: ReadonlySet<string>;
    cutoffDays: number;
    now?: number;
  },
): boolean {
  if (Boolean(session.time.archived) !== onlyArchived) return false;
  if (session.share || getBtwSessionID(session) || session.id === currentSessionId || activeSessionIds.has(session.id)) {
    return false;
  }
  return isOlderThanCutoff(session, now - cutoffDays * DAY_MS, onlyArchived);
}

import type { Session } from '@opencode-ai/sdk/v2';

import { useGlobalSessionsStore } from '@/stores/useGlobalSessionsStore';
import { useUIStore } from '@/stores/useUIStore';
import type { MultiRunCompareGroup } from '@/types/multirun';
import { getAllSyncSessions } from '@/sync/sync-refs';

import { collectMultiRunSiblings, collectMultiRunSiblingsFromAnchors } from './siblings';
import { parseMultiRunSessionTitle } from './title';

const listKnownSessions = (extra: readonly Session[] = []): Session[] => {
  const byId = new Map<string, Session>();
  for (const session of getAllSyncSessions()) byId.set(session.id, session);
  const global = useGlobalSessionsStore.getState();
  for (const session of global.activeSessions) byId.set(session.id, session);
  for (const session of global.archivedSessions) byId.set(session.id, session);
  for (const session of extra) byId.set(session.id, session);
  return Array.from(byId.values());
};

const toCompareGroup = (siblings: Session[], title?: string): MultiRunCompareGroup | null => {
  if (siblings.length === 0) return null;
  const parsed = parseMultiRunSessionTitle(siblings[0]?.title);
  if (!parsed) return null;
  return {
    groupSlug: parsed.groupSlug,
    runGroup: parsed.runGroup,
    title: title?.trim() || parsed.groupSlug,
    sessionIds: siblings.map((session) => session.id),
  };
};

export const openMultiRunCompareForSession = (session: Session, title?: string): boolean => {
  const siblings = collectMultiRunSiblings(session, listKnownSessions([session]));
  const group = toCompareGroup(siblings, title);
  if (!group) return false;
  useUIStore.getState().openMultiRunCompare(group);
  return true;
};

export const openMultiRunCompareForSessions = (sessions: readonly Session[], title?: string): boolean => {
  const siblings = collectMultiRunSiblingsFromAnchors(sessions, listKnownSessions(sessions));
  const group = toCompareGroup(siblings, title);
  if (!group) return false;
  useUIStore.getState().openMultiRunCompare(group);
  return true;
};

export const openMultiRunCompareForSessionIds = (sessionIds: readonly string[], title?: string): boolean => {
  const known = listKnownSessions();
  const byId = new Map(known.map((session) => [session.id, session]));
  const anchors = sessionIds
    .map((sessionId) => byId.get(sessionId))
    .filter((session): session is Session => Boolean(session));
  if (anchors.length === 0) {
    if (sessionIds.length === 0) return false;
    useUIStore.getState().openMultiRunCompare({
      groupSlug: title?.trim() || 'multi-run',
      title: title?.trim() || 'multi-run',
      sessionIds: [...sessionIds],
    });
    return true;
  }
  return openMultiRunCompareForSessions(anchors, title);
};

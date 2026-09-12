import React from 'react';
import type { Session } from '@opencode-ai/sdk/v2';
import { opencodeClient } from '@/lib/opencode/client';
import { ensureGlobalSessionsLoaded, refreshArchivedSessions, useGlobalSessionsStore, resolveGlobalSessionDirectory } from '@/stores/useGlobalSessionsStore';
import { useSessionUIStore } from '@/sync/session-ui-store';
import { getAllSyncSessions } from '@/sync/sync-refs';
import { useUIStore } from '@/stores/useUIStore';
import { useGlobalSessionStatusStore } from '@/sync/global-session-status';
import {
  buildSessionRetentionCandidates,
  isRetentionEligible,
  RETENTION_KEEP_RECENT,
} from '@/sync/session-retention';

const AUTO_DELETE_INTERVAL_MS = 24 * 60 * 60 * 1000;
const EMPTY_SESSIONS: Session[] = [];

type CleanupResult = {
  completedIds: string[];
  failedIds: string[];
  action: 'archive' | 'delete';
  skippedReason?: 'disabled' | 'loading' | 'cooldown' | 'no-candidates' | 'running';
};

type CleanupOptions = {
  autoRun?: boolean;
  enabled?: boolean;
};

export const useSessionAutoCleanup = (enabledOrOptions?: boolean | CleanupOptions) => {
  const options = typeof enabledOrOptions === 'object' ? enabledOrOptions : undefined;
  const autoRun = options?.autoRun !== false;
  const enabled = typeof enabledOrOptions === 'boolean' ? enabledOrOptions : (options?.enabled ?? true);

  const currentSessionId = useSessionUIStore((state) => state.currentSessionId);
  const isLoading = useSessionUIStore((state) => state.isLoading);
  const autoDeleteEnabled = useUIStore((state) => state.autoDeleteEnabled);
  const autoDeleteAfterDays = useUIStore((state) => state.autoDeleteAfterDays);
  const sessionRetentionOnlyArchived = useUIStore((state) => state.sessionRetentionOnlyArchived);
  const sessionRetentionAction = useUIStore((state) => state.sessionRetentionAction);
  const action = sessionRetentionOnlyArchived ? 'delete' as const : sessionRetentionAction;
  const autoDeleteLastRunAt = useUIStore((state) => state.autoDeleteLastRunAt);
  const setAutoDeleteLastRunAt = useUIStore((state) => state.setAutoDeleteLastRunAt);
  const needsGlobalSessions = enabled && (!autoRun || autoDeleteEnabled);
  const globalSessions = useGlobalSessionsStore(React.useCallback(
    (state) => {
      if (!needsGlobalSessions) return EMPTY_SESSIONS;
      return sessionRetentionOnlyArchived ? state.archivedSessions : state.activeSessions;
    },
    [needsGlobalSessions, sessionRetentionOnlyArchived],
  ));
  const hasLoadedGlobalSessions = useGlobalSessionsStore((state) => state.hasLoaded);
  const statusById = useGlobalSessionStatusStore((state) => state.statusById);
  const activeSessionIds = React.useMemo(
    () => new Set(statusById.keys()),
    [statusById],
  );

  const [isRunning, setIsRunning] = React.useState(false);
  const runningRef = React.useRef(false);

  React.useEffect(() => {
    void ensureGlobalSessionsLoaded(getAllSyncSessions());
    if (sessionRetentionOnlyArchived) {
      void refreshArchivedSessions();
    }
  }, [sessionRetentionOnlyArchived]);

  const candidates = React.useMemo(() => {
    if (autoDeleteAfterDays <= 0) return [];
    return buildSessionRetentionCandidates({
      sessions: globalSessions,
      currentSessionId,
      cutoffDays: autoDeleteAfterDays,
      action,
      onlyArchived: sessionRetentionOnlyArchived,
      activeSessionIds,
    });
  }, [action, activeSessionIds, autoDeleteAfterDays, currentSessionId, globalSessions, sessionRetentionOnlyArchived]);

  const runCleanup = React.useCallback(
    async ({ force = false }: { force?: boolean } = {}): Promise<CleanupResult> => {
      if (runningRef.current) {
        return { completedIds: [], failedIds: [], action, skippedReason: 'running' };
      }

      if (!autoDeleteEnabled || autoDeleteAfterDays <= 0) {
        if (!force) {
          return { completedIds: [], failedIds: [], action, skippedReason: 'disabled' };
        }
      }

      if (isLoading) {
        return { completedIds: [], failedIds: [], action, skippedReason: 'loading' };
      }

      const now = Date.now();
      if (!force && autoDeleteLastRunAt && now - autoDeleteLastRunAt < AUTO_DELETE_INTERVAL_MS) {
        return { completedIds: [], failedIds: [], action, skippedReason: 'cooldown' };
      }

      const loaded = await ensureGlobalSessionsLoaded(getAllSyncSessions());
      const sessions = sessionRetentionOnlyArchived
        ? (await refreshArchivedSessions()).archivedSessions
        : loaded.activeSessions;

      if (sessions.length === 0) {
        return { completedIds: [], failedIds: [], action, skippedReason: 'no-candidates' };
      }

      const liveActiveIds = new Set(useGlobalSessionStatusStore.getState().statusById.keys());
      const candidateIds = buildSessionRetentionCandidates({
        sessions,
        currentSessionId,
        cutoffDays: autoDeleteAfterDays,
        action,
        onlyArchived: sessionRetentionOnlyArchived,
        activeSessionIds: liveActiveIds,
        now,
      });

      if (candidateIds.length === 0) {
        setAutoDeleteLastRunAt(now);
        return { completedIds: [], failedIds: [], action, skippedReason: 'no-candidates' };
      }

      runningRef.current = true;
      setIsRunning(true);
      try {
        const sessionMap = new Map(sessions.map((session) => [session.id, session]));
        const completedIds: string[] = [];
        const failedIds: string[] = [];
        const failedSet = new Set<string>();

        for (const id of candidateIds) {
          const session = sessionMap.get(id);
          if (!session || !isRetentionEligible(session, {
            onlyArchived: sessionRetentionOnlyArchived,
            currentSessionId: useSessionUIStore.getState().currentSessionId,
            activeSessionIds: new Set(useGlobalSessionStatusStore.getState().statusById.keys()),
            cutoffDays: autoDeleteAfterDays,
            now,
          })) {
            continue;
          }

          if (action === 'delete') {
            const children = sessions.filter((candidate) => candidate.parentID === id).map((candidate) => candidate.id);
            if (children.length > 0) {
              if (children.some((childId) => failedSet.has(childId))) {
                failedSet.add(id);
                failedIds.push(id);
              }
              continue;
            }
          }

          const directory = resolveGlobalSessionDirectory(session);
          if (!directory) {
            failedSet.add(id);
            failedIds.push(id);
            continue;
          }

          try {
            if (action === 'archive') {
              await opencodeClient.updateSession(id, { time: { archived: Date.now() } }, directory);
            } else {
              await opencodeClient.deleteSession(id, directory);
            }
            completedIds.push(id);
          } catch {
            failedSet.add(id);
            failedIds.push(id);
          }
        }

        if (action === 'archive') {
          useGlobalSessionsStore.getState().archiveSessions(completedIds);
        } else {
          useGlobalSessionsStore.getState().removeSessions(completedIds);
        }
        return { completedIds, failedIds, action };
      } finally {
        runningRef.current = false;
        setIsRunning(false);
        setAutoDeleteLastRunAt(Date.now());
      }
    },
    [
      action,
      autoDeleteAfterDays,
      autoDeleteEnabled,
      autoDeleteLastRunAt,
      currentSessionId,
      isLoading,
      sessionRetentionOnlyArchived,
      setAutoDeleteLastRunAt,
    ]
  );

  React.useEffect(() => {
    if (!enabled || !autoRun) return;
    if (!autoDeleteEnabled || autoDeleteAfterDays <= 0) return;
    if (isLoading || !hasLoadedGlobalSessions || globalSessions.length === 0) return;
    const now = Date.now();
    if (autoDeleteLastRunAt && now - autoDeleteLastRunAt < AUTO_DELETE_INTERVAL_MS) return;
    void runCleanup();
  }, [
    autoDeleteAfterDays,
    autoDeleteEnabled,
    autoDeleteLastRunAt,
    autoRun,
    enabled,
    hasLoadedGlobalSessions,
    globalSessions.length,
    isLoading,
    runCleanup,
  ]);

  return {
    candidates,
    isRunning,
    runCleanup,
    keepRecentCount: RETENTION_KEEP_RECENT,
    action,
    status: hasLoadedGlobalSessions ? 'ready' as const : 'loading' as const,
  };
};

import React from 'react';
import type { Session } from '@opencode-ai/sdk/v2';

import { Icon } from '@/components/icon/Icon';
import { Button } from '@/components/ui/button';
import { ScrollShadow } from '@/components/ui/ScrollShadow';
import { useI18n } from '@/lib/i18n';
import { flattenAssistantTextParts } from '@/lib/messages/messageText';
import { parseMultiRunSessionTitle } from '@/lib/multirun/title';
import { collectMultiRunSiblingsFromAnchors } from '@/lib/multirun/siblings';
import { cn } from '@/lib/utils';
import { resolveGlobalSessionDirectory, useGlobalSessionsStore } from '@/stores/useGlobalSessionsStore';
import { useUIStore } from '@/stores/useUIStore';
import {
  useAllLiveSessions,
  useSessionMessageRecords,
  useSessionRenderable,
  useSessionStatus,
} from '@/sync/sync-context';
import { useSessionUIStore } from '@/sync/session-ui-store';
import { useSync } from '@/sync/use-sync';
import { MultiRunFusionDialog } from './MultiRunFusionDialog';

type CompareRun = {
  session: Session;
  directory: string | null;
};

const listKnownSessions = (
  liveSessions: readonly Session[],
  activeSessions: readonly Session[],
  archivedSessions: readonly Session[],
): Session[] => {
  const byId = new Map<string, Session>();
  for (const session of liveSessions) byId.set(session.id, session);
  for (const session of activeSessions) byId.set(session.id, session);
  for (const session of archivedSessions) byId.set(session.id, session);
  return Array.from(byId.values());
};

const runLabel = (session: Session): string => {
  const parsed = parseMultiRunSessionTitle(session.title);
  if (!parsed) return session.title?.trim() || session.id;
  const model = `${parsed.providerID}/${parsed.modelID}`;
  return parsed.index ? `${model} · ${parsed.index}` : model;
};

const CompareRunColumn: React.FC<{
  run: CompareRun;
  focused: boolean;
  onFocus: () => void;
  onOpen: () => void;
}> = ({ run, focused, onFocus, onOpen }) => {
  const { t } = useI18n();
  const sync = useSync();
  const directory = run.directory ?? '';
  const renderable = useSessionRenderable(run.session.id, directory || undefined);
  const status = useSessionStatus(run.session.id, directory || undefined);
  const records = useSessionMessageRecords(run.session.id, directory || undefined, {
    enabled: Boolean(directory),
  });

  React.useEffect(() => {
    if (!directory) return;
    if (renderable) return;
    void sync.ensureSessionRenderable(run.session.id, false, directory);
  }, [directory, renderable, run.session.id, sync]);

  const isRunning = status?.type === 'busy' || status?.type === 'retry';
  const statusLabel = isRunning
    ? t('multirun.compare.status.running')
    : t('multirun.compare.status.idle');

  return (
    <section
      className={cn(
        'flex min-h-0 min-w-[16rem] flex-1 flex-col overflow-hidden rounded-xl border',
        focused ? 'border-primary/50' : 'border-border',
      )}
      style={{ backgroundColor: 'var(--surface-elevated)' }}
    >
      <header className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
        <button
          type="button"
          onClick={onFocus}
          className="min-w-0 flex-1 truncate text-left typography-ui-label font-medium text-foreground"
        >
          {runLabel(run.session)}
        </button>
        <span
          className={cn(
            'shrink-0 typography-micro',
            isRunning ? 'text-primary' : 'text-muted-foreground',
          )}
        >
          {statusLabel}
        </span>
        <Button type="button" variant="ghost" size="xs" className="normal-case shrink-0" onClick={onOpen}>
          {t('multirun.compare.actions.openRun')}
        </Button>
      </header>
      <ScrollShadow className="min-h-0 flex-1 overflow-auto px-3 py-2" size={32}>
        {!directory ? (
          <p className="typography-meta text-status-error">{t('multirun.compare.run.missingDirectory')}</p>
        ) : records.length === 0 ? (
          <p className="typography-meta text-muted-foreground">
            {renderable ? t('multirun.compare.run.empty') : t('multirun.compare.run.loading')}
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {records.map((record) => {
              const text = flattenAssistantTextParts(record.parts).trim();
              if (!text) return null;
              const isUser = record.info.role === 'user';
              return (
                <div key={record.info.id} className="min-w-0">
                  <div className="typography-micro font-medium text-muted-foreground">
                    {isUser ? t('multirun.compare.role.user') : t('multirun.compare.role.assistant')}
                  </div>
                  <p className="typography-meta whitespace-pre-wrap break-words text-foreground">
                    {text}
                  </p>
                </div>
              );
            })}
          </div>
        )}
      </ScrollShadow>
    </section>
  );
};

export function MultiRunCompareView(): React.ReactNode {
  const { t } = useI18n();
  const compareGroup = useUIStore((state) => state.multiRunCompareGroup);
  const closeMultiRunCompare = useUIStore((state) => state.closeMultiRunCompare);
  const liveSessions = useAllLiveSessions();
  const activeSessions = useGlobalSessionsStore((state) => state.activeSessions);
  const archivedSessions = useGlobalSessionsStore((state) => state.archivedSessions);
  const [focusedSessionId, setFocusedSessionId] = React.useState<string | null>(null);
  const [fusionOpen, setFusionOpen] = React.useState(false);

  const knownSessions = React.useMemo(
    () => listKnownSessions(liveSessions, activeSessions, archivedSessions),
    [activeSessions, archivedSessions, liveSessions],
  );

  const runs = React.useMemo<CompareRun[]>(() => {
    if (!compareGroup) return [];
    const byId = new Map(knownSessions.map((session) => [session.id, session]));
    const anchors = compareGroup.sessionIds
      .map((sessionId) => byId.get(sessionId))
      .filter((session): session is Session => Boolean(session));
    const siblings = anchors.length > 0
      ? collectMultiRunSiblingsFromAnchors(anchors, knownSessions)
      : [];
    const resolved = siblings.length > 0 ? siblings : anchors;
    return resolved.map((session) => ({
      session,
      directory: useSessionUIStore.getState().getDirectoryForSession(session.id)
        ?? resolveGlobalSessionDirectory(session),
    }));
  }, [compareGroup, knownSessions]);

  React.useEffect(() => {
    if (focusedSessionId && runs.some((run) => run.session.id === focusedSessionId)) return;
    setFocusedSessionId(runs[0]?.session.id ?? null);
  }, [focusedSessionId, runs]);

  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (fusionOpen) return;
      event.preventDefault();
      event.stopPropagation();
      closeMultiRunCompare();
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [closeMultiRunCompare, fusionOpen]);

  const handleOpenRun = React.useCallback((sessionId: string, directory: string | null) => {
    closeMultiRunCompare();
    if (directory) {
      useSessionUIStore.getState().setCurrentSession(sessionId, directory);
      return;
    }
    useSessionUIStore.getState().setCurrentSession(sessionId);
  }, [closeMultiRunCompare]);

  if (!compareGroup) return null;

  return (
    <div className="absolute inset-0 z-10 flex h-full min-h-0 w-full flex-col bg-background">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-2">
        <Icon name="layout-column" className="h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div className="truncate typography-ui-label font-medium">{compareGroup.title}</div>
          <div className="truncate typography-micro text-muted-foreground">
            {runs.length === 1
              ? t('multirun.compare.subtitleSingle', { count: runs.length })
              : t('multirun.compare.subtitlePlural', { count: runs.length })}
          </div>
        </div>
        {runs.length >= 2 ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="normal-case"
            onClick={() => setFusionOpen(true)}
          >
            {t('sessions.sidebar.session.menu.runFusion')}
          </Button>
        ) : null}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="normal-case"
          onClick={closeMultiRunCompare}
        >
          {t('multirun.compare.actions.close')}
        </Button>
      </div>

      {runs.length === 0 ? (
        <div className="flex flex-1 items-center justify-center px-6">
          <p className="typography-meta text-muted-foreground">{t('multirun.compare.empty')}</p>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto p-3">
          {runs.map((run) => (
            <CompareRunColumn
              key={run.session.id}
              run={run}
              focused={run.session.id === focusedSessionId}
              onFocus={() => setFocusedSessionId(run.session.id)}
              onOpen={() => handleOpenRun(run.session.id, run.directory)}
            />
          ))}
        </div>
      )}

      {runs[0] ? (
        <MultiRunFusionDialog
          session={runs[0].session}
          open={fusionOpen}
          onOpenChange={setFusionOpen}
        />
      ) : null}
    </div>
  );
}

import React from 'react';
import { useI18n } from '@/lib/i18n';
import { toast } from '@/components/ui';
import { useAllLiveSessions, useAllSessionStatuses, useChildStoreManager, useSessionMessageRecords } from '@/sync/sync-context';
import { useUIStore } from '@/stores/useUIStore';
import { useConfigStore } from '@/stores/useConfigStore';
import { useSessionUIStore } from '@/sync/session-ui-store';
import { useSelectionStore } from '@/sync/selection-store';
import { isVSCodeRuntime } from '@/lib/desktop';
import { isEmbeddedSessionChat } from '@/components/layout/contextPanelEmbeddedChat';
import { WorkStatusCollapsibleSection, WorkStatusRow, WorkStatusValue } from './WorkStatusPrimitives';
import { useReportWorkStatusPresence } from './presenceContext';
import { usePiKernel } from '@/lib/usePiKernel';
import { useEffectiveDirectory } from '@/hooks/useEffectiveDirectory';
import { useFeaturePluginSlotActive } from '@/stores/useFeaturePluginSlotsStore';
import { useSubagentRuns } from '@/hooks/useSubagentRuns';
import { openSubagentChildSession, resolveSubagentChildDirectory } from '@/lib/subagents/childSession';
import {
  buildWorkStatusSubagentRows,
  collectSessionBlockers,
  collectTranscriptSubagentSessionIds,
  overlayWorkStatusChildBlockers,
  overlayWorkStatusSubagentRow,
  resolveWorkStatusSubagentLabel,
  resolveWorkStatusSubagentOpen,
  formatWorkStatusSubagentSummary,
  formatWorkStatusSubagentModelLabel,
  summarizeWorkStatusSubagentRows,
  summarizeSubagentTranscript,
  type WorkStatusSubagentRow,
} from '@/lib/subagents/workStatusRows';
import { usePiExtensionUiStore } from '@/sync/pi-extension-ui-store';
import { useWorkStatusNavigate } from './workStatusNavigate';

type Props = {
  sessionId: string | null;
  directory: string | null;
};

const SECTION_ID = 'subagents';

type ChildRow = WorkStatusSubagentRow;

/**
 * Running subagents and, more importantly, their blockers: a permission request
 * raised by a child session has no representation in the transcript, so this
 * panel is the only place it becomes visible.
 *
 * On Pi the adapter run list is the source of truth. Leftover OpenCode
 * parentID children are not shown as a fleet.
 */
const SUMMARYABLE_STATUSES = new Set<ChildRow['status']>(['done', 'failed', 'stopped']);

type SummaryControlProps = {
  row: ChildRow;
  parentSessionId: string | null;
  parentDirectory: string | null;
  providers: ReadonlyArray<{ id?: string | null; models?: Array<{ id?: string | null }> | null }>;
};

const SubagentSummaryControl: React.FC<SummaryControlProps> = ({ row, parentSessionId, parentDirectory, providers }) => {
  const { t } = useI18n();
  const eligible = Boolean(parentSessionId && row.sessionID && SUMMARYABLE_STATUSES.has(row.status));
  const messages = useSessionMessageRecords(row.sessionID ?? '', row.directory ?? parentDirectory ?? undefined, { enabled: eligible });
  const sendMessage = useSessionUIStore((state) => state.sendMessage);
  const getSessionModelSelection = useSelectionStore((state) => state.getSessionModelSelection);
  const getSessionAgentSelection = useSelectionStore((state) => state.getSessionAgentSelection);
  const [posting, setPosting] = React.useState(false);
  const summary = React.useMemo(() => summarizeSubagentTranscript(messages), [messages]);

  if (!eligible) return null;

  const postSummary = async () => {
    if (!parentSessionId || posting) return;
    const selection = getSessionModelSelection(parentSessionId);
    const providerId = selection?.providerId || providers[0]?.id || '';
    const modelId = selection?.modelId || providers[0]?.models?.[0]?.id || '';
    if (!providerId || !modelId) {
      toast.error(t('chat.agentRoster.missingRunFields'));
      return;
    }
    setPosting(true);
    try {
      const body = summary || t('chat.workStatus.subagent.noSummary');
      await sendMessage(`子智能体「${row.label}」结果（请作为上下文参考）：\n${body}`, providerId, modelId, getSessionAgentSelection(parentSessionId) ?? undefined);
      toast.success(t('chat.workStatus.subagent.summaryPosted'));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('chat.workStatus.subagent.summaryFailed'));
    } finally {
      setPosting(false);
    }
  };

  return (
    <div className="flex justify-end pl-7">
      <button type="button" className="rounded px-1.5 py-0.5 text-[11px] text-primary hover:bg-primary/10 disabled:opacity-50" onClick={() => void postSummary()} disabled={posting}>
        {posting ? t('chat.workStatus.subagent.summarizing') : t('chat.workStatus.subagent.summarize')}
      </button>
    </div>
  );
};

export const WorkStatusSubagentsSection: React.FC<Props> = ({ sessionId, directory }) => {
  const { t } = useI18n();
  const isMobile = useUIStore((state) => state.isMobile);
  const providers = useConfigStore((state) => state.providers);
  const isPiKernel = usePiKernel();
  const subagentsSlotActive = useFeaturePluginSlotActive('subagents', isPiKernel);
  const effectiveDirectory = useEffectiveDirectory() ?? null;

  const liveSessions = useAllLiveSessions();
  const statuses = useAllSessionStatuses();
  const { runs } = useSubagentRuns(sessionId, isPiKernel && subagentsSlotActive, directory ?? effectiveDirectory);
  const parentMessages = useSessionMessageRecords(
    sessionId ?? '',
    directory ?? effectiveDirectory ?? undefined,
    { enabled: isPiKernel && subagentsSlotActive },
  );
  const openCodeChildren = React.useMemo(
    () => (!isPiKernel && sessionId
      ? liveSessions.filter((candidate) => candidate.parentID === sessionId)
      : []),
    [isPiKernel, liveSessions, sessionId],
  );

  const childStores = useChildStoreManager();
  const blockerCacheRef = React.useRef<ReturnType<typeof collectSessionBlockers> | null>(null);
  const getBlockerSnapshot = React.useCallback(() => {
    const next = collectSessionBlockers(Array.from(childStores.children.values(), (store) => store.getState()));
    const current = blockerCacheRef.current;
    if (
      current
      && current.permissions === next.permissions
      && current.questions === next.questions
    ) {
      return current;
    }
    if (
      current
      && Object.keys(current.permissions).length === Object.keys(next.permissions).length
      && Object.keys(current.questions).length === Object.keys(next.questions).length
      && Object.keys(next.permissions).every((id) => current.permissions[id] === next.permissions[id])
      && Object.keys(next.questions).every((id) => current.questions[id] === next.questions[id])
    ) {
      return current;
    }
    blockerCacheRef.current = next;
    return next;
  }, [childStores]);
  const subscribeBlockers = React.useCallback((notify: () => void) => {
    const unsubPermissions = childStores.subscribeAllSelected((state) => state.permission, notify);
    const unsubQuestions = childStores.subscribeAllSelected((state) => state.question, notify);
    return () => {
      unsubPermissions();
      unsubQuestions();
    };
  }, [childStores]);
  const blockers = React.useSyncExternalStore(subscribeBlockers, getBlockerSnapshot, getBlockerSnapshot);
  const promptsBySession = usePiExtensionUiStore((state) => state.promptsBySession);

  const openContextPanelTab = useUIStore((state) => state.openContextPanelTab);
  const setCurrentSession = useSessionUIStore((state) => state.setCurrentSession);
  const setSectionExpanded = useUIStore((state) => state.setWorkStatusSectionExpanded);
  const onNavigate = useWorkStatusNavigate();

  const rows = React.useMemo<ChildRow[]>(() => {
    if (isPiKernel) {
      return overlayWorkStatusChildBlockers(buildWorkStatusSubagentRows({
        runs,
        transcriptIds: collectTranscriptSubagentSessionIds(parentMessages),
        directory,
        effectiveDirectory,
        untitledLabel: t('chat.workStatus.subagent.untitled'),
      }).map((row) => {
        const liveTitle = liveSessions.find((session) => session.id === row.sessionID)?.title;
        return {
          ...row,
          label: resolveWorkStatusSubagentLabel(
            { title: row.label, name: row.label },
            liveTitle,
            t('chat.workStatus.subagent.untitled'),
          ),
        };
      }), blockers).map((row) => overlayWorkStatusSubagentRow(row, {
        uiPrompt: Boolean(row.sessionID && (promptsBySession[row.sessionID] ?? []).some((prompt) => prompt.status === 'pending')),
      }));
    }
    return openCodeChildren.map((child) => {
      const childDirectory = resolveSubagentChildDirectory(child, directory || effectiveDirectory);
      const blocked = (blockers.permissions[child.id]?.length ?? 0) > 0;
      const asked = (blockers.questions[child.id]?.length ?? 0) > 0;
      const busy = statuses[child.id]?.type === 'busy';
      const opened = resolveWorkStatusSubagentOpen({
        sessionID: child.id,
        directory: childDirectory,
        effectiveDirectory: directory || effectiveDirectory,
      });
      return {
        id: child.id,
        label: resolveWorkStatusSubagentLabel(
        { title: child.title ?? '', name: '' },
        child.title,
        t('chat.workStatus.subagent.untitled'),
      ),
        sessionID: opened.sessionID,
        directory: opened.directory,
        openable: opened.openable,
        status: blocked ? 'permission' : asked ? 'question' : busy ? 'working' : 'done',
      };
    });
  }, [blockers, directory, effectiveDirectory, isPiKernel, liveSessions, openCodeChildren, parentMessages, promptsBySession, runs, statuses, t]);

  const hadChildren = React.useRef(rows.length > 0);
  React.useEffect(() => {
    const present = rows.length > 0;
    if (present && !hadChildren.current) setSectionExpanded(SECTION_ID, true);
    hadChildren.current = present;
  }, [rows.length, setSectionExpanded]);

  const openChildSession = React.useCallback((row: ChildRow) => {
    if (!row.openable) return;
    const opened = openSubagentChildSession({
      sessionID: row.sessionID,
      parentSessionID: sessionId,
      directory: resolveSubagentChildDirectory(row, directory || effectiveDirectory),
      label: row.label,
      readOnly: !isPiKernel,
      isMobile,
      isVSCode: isVSCodeRuntime(),
      isEmbedded: isEmbeddedSessionChat(),
      setCurrentSession,
      openContextPanelTab,
    });
    if (opened) onNavigate?.();
  }, [directory, effectiveDirectory, isMobile, isPiKernel, onNavigate, openContextPanelTab, sessionId, setCurrentSession]);

  useReportWorkStatusPresence('subagents', rows.length > 0);

  if (isPiKernel && !subagentsSlotActive) return null;
  if (rows.length === 0) return null;

  const summary = formatWorkStatusSubagentSummary(summarizeWorkStatusSubagentRows(rows), {
    queued: t('chat.workStatus.subagent.queued'),
    done: t('chat.workStatus.subagent.done'),
  });

  return (
    <WorkStatusCollapsibleSection
      id={SECTION_ID}
      title={t('chat.workStatus.section.subagents')}
      icon="ai-agent"
      defaultExpanded
      summary={summary}
    >
      <div className="max-h-56 overflow-y-auto">
        {rows.map((row) => {
          const provider = row.providerId ? providers.find((entry) => entry.id === row.providerId) : undefined;
          const model = provider?.models?.find((entry) => entry.id === row.modelId);
          const modelLabel = formatWorkStatusSubagentModelLabel({
            providerId: row.providerId,
            modelId: row.modelId,
            providerName: provider?.name,
            modelName: model?.name,
          });
          return (
          <React.Fragment key={row.id}>
          <WorkStatusRow
            key={row.id}
            onClick={row.openable ? () => openChildSession(row) : undefined}
            actionLabel={row.openable ? t('chat.workStatus.action.open') : undefined}
            disabled={!row.openable}
            title={row.openable ? undefined : t('chat.workStatus.subagent.unopenableTooltip')}
            ariaLabel={row.openable
              ? t('chat.workStatus.action.openSubagent', { name: row.label })
              : row.label}
            label={(
              <>
                {row.mode === 'background'
                  ? t('chat.workStatus.subagent.namedBackground', { name: row.label })
                  : row.mode === 'foreground'
                    ? t('chat.workStatus.subagent.namedForeground', { name: row.label })
                    : row.label}
                {modelLabel ? <span className="text-muted-foreground"> · {modelLabel}</span> : null}
              </>
            )}
            value={row.status === 'permission' ? (
              <WorkStatusValue tone="warning">{t('chat.workStatus.subagent.needsPermission')}</WorkStatusValue>
            ) : row.status === 'question' ? (
              <WorkStatusValue tone="warning">{t('chat.workStatus.subagent.askedQuestion')}</WorkStatusValue>
            ) : row.status === 'blocked' ? (
              <WorkStatusValue tone="warning">{t('chat.workStatus.subagent.blocked')}</WorkStatusValue>
            ) : row.status === 'paused' ? (
              <WorkStatusValue tone="warning">{t('chat.workStatus.subagent.paused')}</WorkStatusValue>
            ) : row.status === 'failed' ? (
              <WorkStatusValue tone="warning">{t('chat.workStatus.subagent.failed')}</WorkStatusValue>
            ) : row.status === 'queued' ? (
              <WorkStatusValue tone="muted">{t('chat.workStatus.subagent.queued')}</WorkStatusValue>
            ) : row.status === 'stopped' ? (
              <WorkStatusValue tone="muted">{t('chat.workStatus.subagent.stopped')}</WorkStatusValue>
            ) : row.status === 'working' ? (
              <WorkStatusValue tone="info">{t('chat.workStatus.subagent.working')}</WorkStatusValue>
            ) : (
              <WorkStatusValue tone="muted">{t('chat.workStatus.subagent.done')}</WorkStatusValue>
            )}
          />
          <SubagentSummaryControl row={row} parentSessionId={sessionId} parentDirectory={directory || effectiveDirectory} providers={providers} />
          </React.Fragment>
          );
        })}
      </div>
    </WorkStatusCollapsibleSection>
  );
};

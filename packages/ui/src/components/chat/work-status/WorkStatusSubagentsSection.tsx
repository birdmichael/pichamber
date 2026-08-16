import React from 'react';
import { useI18n } from '@/lib/i18n';
import { useAllLiveSessions, useAllSessionStatuses, useDirectorySync } from '@/sync/sync-context';
import { useUIStore } from '@/stores/useUIStore';
import { useSessionUIStore } from '@/sync/session-ui-store';
import { isVSCodeRuntime } from '@/lib/desktop';
import { isEmbeddedSessionChat } from '@/components/layout/contextPanelEmbeddedChat';
import { WorkStatusCollapsibleSection, WorkStatusRow, WorkStatusValue } from './WorkStatusPrimitives';
import { useReportWorkStatusPresence } from './presenceContext';
import type { State } from '@/sync/types';
import { usePiKernel } from '@/lib/usePiKernel';
import { useFeaturePluginSlotActive } from '@/stores/useFeaturePluginSlotsStore';
import { useSubagentRuns } from '@/hooks/useSubagentRuns';
import { openSubagentChildSession } from '@/lib/subagents/childSession';
import type { SubagentRun } from '@/lib/subagents/subagentRuns';

type Props = {
  sessionId: string | null;
  directory: string | null;
};

const SECTION_ID = 'subagents';

type ChildRow = {
  id: string;
  label: string;
  sessionID: string | null;
  openable: boolean;
  status: 'permission' | 'question' | 'working' | 'blocked' | 'failed' | 'paused' | 'done';
  mode?: 'foreground' | 'background';
};

/**
 * Running subagents and, more importantly, their blockers: a permission request
 * raised by a child session has no representation in the transcript, so this
 * panel is the only place it becomes visible.
 *
 * On Pi the adapter run list is the source of truth. Leftover OpenCode
 * parentID children are not shown as a fleet.
 */
export const WorkStatusSubagentsSection: React.FC<Props> = ({ sessionId, directory }) => {
  const { t } = useI18n();
  const isMobile = useUIStore((state) => state.isMobile);
  const isPiKernel = usePiKernel();
  const subagentsSlotActive = useFeaturePluginSlotActive('subagents', isPiKernel);

  const liveSessions = useAllLiveSessions();
  const statuses = useAllSessionStatuses();
  const { runs } = useSubagentRuns(sessionId, isPiKernel && subagentsSlotActive);
  const openCodeChildren = React.useMemo(
    () => (!isPiKernel && sessionId
      ? liveSessions.filter((candidate) => candidate.parentID === sessionId)
      : []),
    [isPiKernel, liveSessions, sessionId],
  );

  const permissions = useDirectorySync(React.useCallback((state: State) => state.permission, []));
  const questions = useDirectorySync(React.useCallback((state: State) => state.question, []));

  const openContextPanelTab = useUIStore((state) => state.openContextPanelTab);
  const setCurrentSession = useSessionUIStore((state) => state.setCurrentSession);
  const setSectionExpanded = useUIStore((state) => state.setWorkStatusSectionExpanded);

  const rows = React.useMemo<ChildRow[]>(() => {
    if (isPiKernel) {
      return runs.map((run: SubagentRun) => ({
        id: run.runId,
        label: run.title?.trim() || run.name || t('chat.workStatus.subagent.untitled'),
        sessionID: run.sessionID,
        openable: run.openable,
        mode: run.mode,
        status: run.state === 'running' || run.state === 'queued'
          ? 'working'
          : run.state === 'blocked'
            ? 'blocked'
            : run.state === 'paused'
              ? 'paused'
              : run.state === 'failed' || run.state === 'stopped'
                ? 'failed'
                : 'done',
      }));
    }
    return openCodeChildren.map((child) => {
      const blocked = (permissions[child.id]?.length ?? 0) > 0;
      const asked = (questions[child.id]?.length ?? 0) > 0;
      const busy = statuses[child.id]?.type === 'busy';
      return {
        id: child.id,
        label: child.title?.trim() || t('chat.workStatus.subagent.untitled'),
        sessionID: child.id,
        openable: Boolean(directory),
        status: blocked ? 'permission' : asked ? 'question' : busy ? 'working' : 'done',
      };
    });
  }, [directory, isPiKernel, openCodeChildren, permissions, questions, runs, statuses, t]);

  const hadChildren = React.useRef(rows.length > 0);
  React.useEffect(() => {
    const present = rows.length > 0;
    if (present && !hadChildren.current) setSectionExpanded(SECTION_ID, true);
    hadChildren.current = present;
  }, [rows.length, setSectionExpanded]);

  const openChildSession = React.useCallback((row: ChildRow) => {
    if (!row.openable) return;
    openSubagentChildSession({
      sessionID: row.sessionID,
      directory,
      label: row.label,
      readOnly: !isPiKernel,
      isMobile,
      isVSCode: isVSCodeRuntime(),
      isEmbedded: isEmbeddedSessionChat(),
      setCurrentSession,
      openContextPanelTab,
    });
  }, [directory, isMobile, isPiKernel, openContextPanelTab, setCurrentSession]);

  useReportWorkStatusPresence('subagents', rows.length > 0);

  if (isPiKernel && !subagentsSlotActive) return null;
  if (rows.length === 0) return null;

  const busyChildren = rows.filter((row) => row.status === 'working' || row.status === 'blocked').length;

  return (
    <WorkStatusCollapsibleSection
      id={SECTION_ID}
      title={t('chat.workStatus.section.subagents')}
      icon="ai-agent"
      defaultExpanded
      summary={busyChildren > 0 ? `${busyChildren}/${rows.length}` : rows.length}
    >
      <div className="max-h-56 overflow-y-auto">
        {rows.map((row) => (
          <WorkStatusRow
            key={row.id}
            onClick={row.openable ? () => openChildSession(row) : undefined}
            ariaLabel={row.openable
              ? t('chat.workStatus.action.openSubagent', { name: row.label })
              : row.label}
            label={row.mode === 'background'
              ? t('chat.workStatus.subagent.namedBackground', { name: row.label })
              : row.mode === 'foreground'
                ? t('chat.workStatus.subagent.namedForeground', { name: row.label })
                : row.label}
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
            ) : row.status === 'working' ? (
              <WorkStatusValue tone="info">{t('chat.workStatus.subagent.working')}</WorkStatusValue>
            ) : (
              <WorkStatusValue tone="muted">{t('chat.workStatus.subagent.done')}</WorkStatusValue>
            )}
          />
        ))}
      </div>
    </WorkStatusCollapsibleSection>
  );
};

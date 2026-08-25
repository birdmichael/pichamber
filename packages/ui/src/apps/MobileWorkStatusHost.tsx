import React from 'react';

import { WorkStatusGoalRow } from '@/components/chat/work-status/WorkStatusGoalRow';
import { WorkStatusMcpSection } from '@/components/chat/work-status/WorkStatusMcpSection';
import { WorkStatusPrimaryGroup } from '@/components/chat/work-status/WorkStatusPrimaryGroup';
import { WorkStatusSubagentsSection } from '@/components/chat/work-status/WorkStatusSubagentsSection';
import { WorkStatusTasksSection } from '@/components/chat/work-status/WorkStatusTasksSection';
import { WorkStatusUsageSection } from '@/components/chat/work-status/WorkStatusUsageSection';
import { isWorkStatusSectionVisible } from '@/components/chat/work-status/sections';
import { useMcpFeaturePluginActive, usePiKernel } from '@/lib/usePiKernel';
import { useFeaturePluginSlotActive } from '@/stores/useFeaturePluginSlotsStore';
import { useUIStore } from '@/stores/useUIStore';

/**
 * Touch host for Desktop Work Status rows.
 *
 * Work Status is a 300px chat-column card (`WorkStatusPanel`). Mobile never
 * mounts that card (`useWorkStatusVisibility` / `workStatusPanelMountable`).
 * This host wraps the same section components in `MobileSessionMetadata`.
 * It is not the Desktop Context rail (`CONTEXT_SURFACES` id `context`).
 */
export const MobileWorkStatusHost: React.FC<{
  sessionId: string | null;
  directory: string | null;
  /** Managed Chats have no project repository, even if another project remains active. */
  repositoryEnabled?: boolean;
}> = ({ sessionId, directory, repositoryEnabled = true }) => {
  const hiddenSections = useUIStore((state) => state.workStatusHiddenSections);
  const isPiKernel = usePiKernel();
  const isMcpFeaturePluginActive = useMcpFeaturePluginActive();
  const subagentsSlotActive = useFeaturePluginSlotActive('subagents', isPiKernel);
  const todoSlotActive = useFeaturePluginSlotActive('todo', isPiKernel);
  const sectionContext = React.useMemo(
    () => ({ isPiKernel, isMcpFeaturePluginActive, subagentsSlotActive, todoSlotActive }),
    [isMcpFeaturePluginActive, isPiKernel, subagentsSlotActive, todoSlotActive],
  );
  const sectionVisible = React.useCallback(
    (sectionId: Parameters<typeof isWorkStatusSectionVisible>[1]) =>
      isWorkStatusSectionVisible(hiddenSections, sectionId, sectionContext),
    [hiddenSections, sectionContext],
  );

  return (
    <div data-work-status-host="session-metadata">
      {sectionVisible('tasks') ? <WorkStatusTasksSection sessionId={sessionId} directory={directory} /> : null}
      <WorkStatusPrimaryGroup
        sessionId={sessionId}
        directory={directory}
        showSession={sectionVisible('session')}
        showRepository={repositoryEnabled && sectionVisible('repository')}
        goalRow={<WorkStatusGoalRow sessionId={sessionId} directory={directory} />}
      />
      {sectionVisible('usage') ? <WorkStatusUsageSection /> : null}
      {sectionVisible('subagents') ? <WorkStatusSubagentsSection sessionId={sessionId} directory={directory} /> : null}
      {sectionVisible('mcp') ? <WorkStatusMcpSection directory={directory} /> : null}
    </div>
  );
};

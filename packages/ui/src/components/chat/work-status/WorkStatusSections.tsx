import React from 'react';

import { WorkStatusContextSection } from './WorkStatusContextSection';
import { WorkStatusGoalRow } from './WorkStatusGoalRow';
import { WorkStatusMcpSection } from './WorkStatusMcpSection';
import { WorkStatusPinnedSection } from './WorkStatusPinnedSection';
import { WorkStatusPrimaryGroup } from './WorkStatusPrimaryGroup';
import { WorkStatusSubagentsSection } from './WorkStatusSubagentsSection';
import { WorkStatusTasksSection } from './WorkStatusTasksSection';
import { WorkStatusUsageSection } from './WorkStatusUsageSection';
import { useWorkStatusSectionVisibility } from './useWorkStatusSectionVisibility';

/**
 * The labelled Work Status rows, in Desktop order. Both the chat-column card
 * and the mobile session-metadata overlay render this — do not fork a second
 * row model for touch.
 */
export const WorkStatusSections: React.FC<{
  sessionId: string | null;
  directory: string | null;
}> = ({ sessionId, directory }) => {
  const { sectionVisible } = useWorkStatusSectionVisibility();
  return (
    <>
      <WorkStatusPrimaryGroup
        sessionId={sessionId}
        directory={directory}
        showSession={sectionVisible('session')}
        showRepository={sectionVisible('repository')}
        goalRow={<WorkStatusGoalRow sessionId={sessionId} directory={directory} />}
      />
      {sectionVisible('usage') ? <WorkStatusUsageSection /> : null}
      {sectionVisible('subagents') ? <WorkStatusSubagentsSection sessionId={sessionId} directory={directory} /> : null}
      {sectionVisible('tasks') ? <WorkStatusTasksSection sessionId={sessionId} directory={directory} /> : null}
      {sectionVisible('mcp') ? <WorkStatusMcpSection directory={directory} /> : null}
      {sectionVisible('pinned') ? <WorkStatusPinnedSection sessionId={sessionId} directory={directory} /> : null}
      {sectionVisible('contextSources') ? <WorkStatusContextSection sessionId={sessionId} directory={directory} /> : null}
    </>
  );
};

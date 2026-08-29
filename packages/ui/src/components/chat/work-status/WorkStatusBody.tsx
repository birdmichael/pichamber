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

type Props = {
  sessionId: string | null;
  directory: string | null;
  repositoryEnabled?: boolean;
};

/**
 * Section list in Desktop display order. Desktop's card and the mobile host
 * both render this; visibility stays in `useWorkStatusSectionVisibility`.
 *
 * Order: tasks, PrimaryGroup (session + repository), usage, subagents, mcp,
 * pinned, contextSources.
 */
export const WorkStatusBody: React.FC<Props> = ({
  sessionId,
  directory,
  repositoryEnabled = true,
}) => {
  const { sectionVisible } = useWorkStatusSectionVisibility();

  return (
    <>
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
      {sectionVisible('pinned') ? <WorkStatusPinnedSection sessionId={sessionId} directory={directory} /> : null}
      {sectionVisible('contextSources') ? <WorkStatusContextSection sessionId={sessionId} directory={directory} /> : null}
    </>
  );
};

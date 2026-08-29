import React from 'react';

import { WorkStatusContents } from '@/components/chat/work-status/WorkStatusContents';

/**
 * Touch host for Desktop Work Status rows.
 *
 * Work Status is a 300px chat-column card (`WorkStatusPanel`). Mobile never
 * mounts that card (`useWorkStatusVisibility` / `workStatusPanelMountable`).
 * This host wraps the shared `WorkStatusContents` chrome in
 * `MobileSessionMetadata`. It is not the Desktop Context rail
 * (`CONTEXT_SURFACES` id `context`).
 */
export const MobileWorkStatusHost: React.FC<{
  sessionId: string | null;
  directory: string | null;
  /** Managed Chats have no project repository, even if another project remains active. */
  repositoryEnabled?: boolean;
  onSectionsDialogOpenChange?: (open: boolean) => void;
  onNavigate?: () => void;
}> = ({ sessionId, directory, repositoryEnabled = true, onSectionsDialogOpenChange, onNavigate }) => (
  <div data-work-status-host="session-metadata" className="relative flex min-h-0 flex-col">
    <WorkStatusContents
      sessionId={sessionId}
      directory={directory}
      repositoryEnabled={repositoryEnabled}
      onSectionsDialogOpenChange={onSectionsDialogOpenChange}
      onNavigate={onNavigate}
    />
  </div>
);
